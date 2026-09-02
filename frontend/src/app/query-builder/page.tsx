"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Editor, { OnMount, Monaco } from "@monaco-editor/react";
import {
  ChevronDown, ChevronLeft, ChevronRight, Plug, Play, ExternalLink, Plus, Trash2, Loader2, CheckSquare, Square,
  Eraser, RotateCcw, ChevronUp, Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { QueryResultGrid } from "@/components/QueryResultGrid";
import { api, Connection, SchemaTree, QueryExecuteResult, ErdData, RelatedTable, getRelatedTables } from "@/lib/api";
import { SQL_KEYWORD_GROUPS } from "@/lib/sql-keywords";
import { registerSqlCompletionProvider } from "@/lib/sql-completions";

interface FilterRow {
  column: string;
  op: string;
  value: string;
}

const OPS = ["=", "!=", ">", "<", ">=", "<=", "LIKE", "ILIKE", "IS NULL", "IS NOT NULL"];

// ILIKE (case-insensitive LIKE) is PostgreSQL-only syntax — MySQL/MariaDB
// and SQLite don't recognize it and will error out. Hide it from the
// operator list unless the active connection is PostgreSQL.
function opsForDbType(dbType: string | undefined): string[] {
  if (dbType === "postgresql") return OPS;
  return OPS.filter((op) => op !== "ILIKE");
}

// ---- Persistence: keep table/columns/filters/sql picked in the builder
// across page refreshes, until the user clicks "Clear All".
const QB_STATE_KEY = "dbx:qb-state-v1";

interface PersistedQBState {
  activeConnId: string | null;
  schema: string;
  table: string;
  selectedColumns: string[];
  filters: FilterRow[];
  orderBy: string;
  orderDir: "asc" | "desc";
  limit: number;
  manualSql: string | null;
}

function loadPersistedQBState(): Partial<PersistedQBState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(QB_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function clearPersistedQBState() {
  try {
    window.localStorage.removeItem(QB_STATE_KEY);
  } catch {
    // ignore
  }
}

// Identifier quoting is dialect-specific: PostgreSQL and SQLite both accept
// ANSI double-quotes, but MySQL/MariaDB (outside of ANSI_QUOTES sql_mode,
// which we can't assume is set on the user's server) treat "..." as a
// *string literal*, not an identifier — so double-quoted SQL generated
// here would fail against a MySQL/MariaDB connection. Quote with backticks
// for those instead, matching what the backend's MySQLAdapter does.
function quoteIdent(name: string, dbType: string = "postgresql"): string {
  if (dbType === "mysql" || dbType === "mariadb") {
    return "`" + String(name).replace(/`/g, "``") + "`";
  }
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteValue(op: string, value: string): string {
  if (op === "IS NULL" || op === "IS NOT NULL") return "";
  if (value.trim() === "") return "''";
  if (!isNaN(Number(value)) && value.trim() !== "") return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function parseColumnRef(raw: string, primaryTable: string): { table: string; column: string } {
  const dot = raw.indexOf(".");
  if (dot === -1) return { table: primaryTable, column: raw };
  return { table: raw.slice(0, dot), column: raw.slice(dot + 1) };
}

function buildSql(
  schema: string,
  table: string,
  columns: string[],
  filters: FilterRow[],
  orderBy: string,
  orderDir: "asc" | "desc",
  limit: number,
  relatedTables: RelatedTable[],
  dbType: string = "postgresql"
): string {
  if (!table) return "";

  const validFilters = filters.filter((f) => f.column);

  // Any column — whether an output column or a filter — can be a plain
  // name (primary table) or "relatedTable.column" (picked from a relation
  // group). Collect which related tables are actually referenced anywhere
  // so we only JOIN what's needed.
  const usedRelated = new Map<string, RelatedTable>();
  const noteRelated = (raw: string) => {
    const dot = raw.indexOf(".");
    if (dot === -1) return;
    const refTable = raw.slice(0, dot);
    const rt = relatedTables.find((r) => r.table === refTable);
    if (rt) usedRelated.set(rt.table, rt);
  };
  columns.forEach(noteRelated);
  validFilters.forEach((f) => noteRelated(f.column));

  const joins = [...usedRelated.values()];
  const hasJoins = joins.length > 0;

  // Only qualify identifiers with a table name once a join is in play —
  // keeps the generated SQL identical to before for the common single-table case.
  const qualify = (raw: string) => {
    const { table: refTable, column } = parseColumnRef(raw, table);
    return hasJoins
      ? `${quoteIdent(refTable, dbType)}.${quoteIdent(column, dbType)}`
      : quoteIdent(column, dbType);
  };

  const colList =
    columns.length > 0
      ? columns.map(qualify).join(", ")
      : hasJoins
      ? `${quoteIdent(table, dbType)}.*`
      : "*";

  let sql = `SELECT\n    ${colList}\nFROM ${quoteIdent(schema, dbType)}.${quoteIdent(table, dbType)}`;

  for (const rt of joins) {
    sql += `\nLEFT JOIN ${quoteIdent(schema, dbType)}.${quoteIdent(rt.table, dbType)} ON ${quoteIdent(
      table,
      dbType
    )}.${quoteIdent(rt.localColumn, dbType)} = ${quoteIdent(rt.table, dbType)}.${quoteIdent(
      rt.foreignColumn,
      dbType
    )}`;
  }

  if (validFilters.length > 0) {
    const clauses = validFilters.map((f) => {
      const colRef = qualify(f.column);
      // Guard against a filter row that was set to ILIKE (Postgres-only)
      // before the connection was switched to a non-Postgres database —
      // fall back to plain LIKE so the generated SQL stays valid.
      const op = f.op === "ILIKE" && dbType !== "postgresql" ? "LIKE" : f.op;
      if (op === "IS NULL" || op === "IS NOT NULL") return `${colRef} ${op}`;
      return `${colRef} ${op} ${quoteValue(op, f.value)}`;
    });
    sql += `\nWHERE ${clauses.join("\n  AND ")}`;
  }

  if (orderBy) {
    sql += `\nORDER BY ${qualify(orderBy)} ${orderDir.toUpperCase()}`;
  }
  if (limit > 0) {
    sql += `\nLIMIT ${limit}`;
  }
  return sql + ";";
}

export default function QueryBuilderPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnId, setActiveConnId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tree, setTree] = useState<SchemaTree | null>(null);

  const [schema, setSchema] = useState("");
  const [table, setTable] = useState("");
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [orderBy, setOrderBy] = useState("");
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("asc");
  const [limit, setLimit] = useState(100);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryExecuteResult | null>(null);

  const [erdData, setErdData] = useState<ErdData | null>(null);

  // Manual SQL editing + keyword-insert toolbar. When null, the SQL box
  // just mirrors the auto-generated query from the builder above. As soon
  // as the user types in the box or inserts a keyword/function, it "forks"
  // into manual mode and stops following the builder until reset.
  const [manualSql, setManualSql] = useState<string | null>(null);
  const [openKeywordGroup, setOpenKeywordGroup] = useState<string | null>(null);

  // Monaco instance for the manual SQL box, plus the same refs the SQL
  // Editor uses to feed the shared completion provider (table/column
  // suggestions need the latest schema tree + connection without forcing
  // the provider to be re-registered on every change).
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const columnCacheRef = useRef<Record<string, { name: string; type: string }[]>>({});
  const activeConnIdRef = useRef<string | null>(null);
  const treeRef = useRef<SchemaTree | null>(null);
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null);

  // Dispose the completion provider when this page unmounts — Monaco is a
  // singleton across client-side navigations, so leaving it registered
  // would stack a duplicate provider if the user comes back to this page.
  useEffect(() => {
    return () => completionDisposableRef.current?.dispose();
  }, []);

  // Snapshot of whatever was saved in localStorage, taken once on the very
  // first render (before any save-effect below has a chance to overwrite
  // it). All restore effects read from this stable snapshot instead of
  // re-reading localStorage, so intermediate state changes during the
  // restore cascade can never clobber the data we're restoring from.
  const initialPersistedRef = useRef<Partial<PersistedQBState> | null>(null);
  if (initialPersistedRef.current === null) {
    initialPersistedRef.current = loadPersistedQBState();
  }
  const initialPersisted = initialPersistedRef.current;
  const didRestoreTableRef = useRef(false);
  const didRestoreExtrasRef = useRef(false);
  const prevSchemaRef = useRef("");

  // Freely resizable / collapsible builder panel, so the results area can
  // be given as much (or as little) room as the user wants.
  const SIDEBAR_MIN = 260;
  const SIDEBAR_MAX = 720;
  const SIDEBAR_WIDTH_KEY = "dbx:qb-sidebar-width";
  const SIDEBAR_COLLAPSED_KEY = "dbx:qb-sidebar-collapsed";

  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    try {
      const storedWidth = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (storedWidth) {
        const parsed = parseInt(storedWidth, 10);
        if (!Number.isNaN(parsed)) {
          setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parsed)));
        }
      }
      setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // localStorage unavailable — just keep the defaults.
    }
  }, []);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX - rect.left));
      setSidebarWidth(next);
    }
    function onMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setSidebarWidth((w) => {
        try {
          window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
        } catch {
          // ignore
        }
        return w;
      });
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  useEffect(() => {
    api.listConnections().then((cs) => {
      setConnections(cs);
      if (initialPersisted.activeConnId && cs.some((c) => c.id === initialPersisted.activeConnId)) {
        setActiveConnId(initialPersisted.activeConnId);
      } else if (cs.length > 0) {
        setActiveConnId(cs[0].id);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeConnId) return;
    api.getSchemas(activeConnId).then((t) => {
      setTree(t);
      if (initialPersisted.schema && t.schemas.some((s) => s.schema === initialPersisted.schema)) {
        setSchema(initialPersisted.schema);
      } else if (t.schemas.length > 0) {
        setSchema(t.schemas[0].schema);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnId]);

  // Resets the table/column selection when the user switches schema. The
  // very first time `schema` gets populated (default pick OR restored from
  // storage) is not a "real" change, so it's skipped — that's what lets a
  // restored table survive this effect.
  useEffect(() => {
    const prev = prevSchemaRef.current;
    prevSchemaRef.current = schema;
    if (prev === "" || prev === schema) return;
    setTable("");
    setAvailableColumns([]);
    setSelectedColumns(new Set());
  }, [schema]);

  // Once schema + tree are both known, try (once) to restore the
  // previously-picked table from storage.
  useEffect(() => {
    if (didRestoreTableRef.current) return;
    if (!schema || !tree) return;
    didRestoreTableRef.current = true;
    const tables = tree.schemas.find((s) => s.schema === schema)?.tables ?? [];
    if (
      initialPersisted.table &&
      initialPersisted.schema === schema &&
      tables.some((t) => t.name === initialPersisted.table)
    ) {
      setTable(initialPersisted.table);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, tree]);

  useEffect(() => {
    if (!activeConnId || !schema || !table) {
      setAvailableColumns([]);
      return;
    }
    api.getTableStructure(activeConnId, schema, table).then((s) => {
      const cols = s.columns.map((c) => c.name);
      setAvailableColumns(cols);
      setSelectedColumns(new Set(cols));
    }).catch(() => {});
    setFilters([]);
    setOrderBy("");
    setResult(null);
    setManualSql(null);
  }, [activeConnId, schema, table]);

  // Once columns for the (possibly restored) table have loaded, apply the
  // saved filters/order/limit/manual-SQL on top of the defaults the effect
  // above just set — but only once, and only if they belong to this same
  // table, so normal table switches afterwards keep resetting as before.
  useEffect(() => {
    if (didRestoreExtrasRef.current) return;
    if (availableColumns.length === 0 || !table) return;
    didRestoreExtrasRef.current = true;
    if (initialPersisted.table !== table || initialPersisted.schema !== schema) return;
    if (initialPersisted.selectedColumns && initialPersisted.selectedColumns.length > 0) {
      setSelectedColumns(new Set(initialPersisted.selectedColumns));
    }
    if (initialPersisted.filters) setFilters(initialPersisted.filters);
    if (initialPersisted.orderBy) setOrderBy(initialPersisted.orderBy);
    if (initialPersisted.orderDir) setOrderDir(initialPersisted.orderDir);
    if (typeof initialPersisted.limit === "number") setLimit(initialPersisted.limit);
    if (typeof initialPersisted.manualSql === "string") setManualSql(initialPersisted.manualSql);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableColumns, table, schema]);

  // Save the builder's state on every change so a page refresh doesn't
  // lose it. "Clear All" wipes both the state and this saved copy.
  useEffect(() => {
    try {
      const toSave: PersistedQBState = {
        activeConnId,
        schema,
        table,
        selectedColumns: [...selectedColumns],
        filters,
        orderBy,
        orderDir,
        limit,
        manualSql,
      };
      window.localStorage.setItem(QB_STATE_KEY, JSON.stringify(toSave));
    } catch {
      // ignore
    }
  }, [activeConnId, schema, table, selectedColumns, filters, orderBy, orderDir, limit, manualSql]);

  useEffect(() => {
    if (!activeConnId || !schema) {
      setErdData(null);
      return;
    }
    api.getErd(activeConnId, schema).then(setErdData).catch(() => setErdData(null));
  }, [activeConnId, schema]);

  useEffect(() => {
    activeConnIdRef.current = activeConnId;
  }, [activeConnId]);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);
  useEffect(() => {
    columnCacheRef.current = {};
  }, [activeConnId]);

  const activeConnection = connections.find((c) => c.id === activeConnId);
  const currentSchemaTables = tree?.schemas.find((s) => s.schema === schema)?.tables ?? [];

  const relatedTables: RelatedTable[] = erdData && table ? getRelatedTables(erdData, table) : [];

  const sql = buildSql(
    schema,
    table,
    [...selectedColumns],
    filters,
    orderBy,
    orderDir,
    limit,
    relatedTables,
    activeConnection?.db_type
  );

  // What actually shows in the SQL box / gets run: the auto-generated SQL,
  // unless the user has forked off into manual edits.
  const activeSql = manualSql ?? sql;

  function toggleColumn(col: string) {
    setSelectedColumns((s) => {
      const next = new Set(s);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  }

  function allColumnsSelected(cols: string[]): boolean {
    return cols.length > 0 && cols.every((c) => selectedColumns.has(c));
  }

  function toggleAllColumns(cols: string[]) {
    setSelectedColumns((s) => {
      const next = new Set(s);
      const allSelected = cols.every((c) => next.has(c));
      cols.forEach((c) => (allSelected ? next.delete(c) : next.add(c)));
      return next;
    });
  }

  function addFilter() {
    setFilters((f) => [...f, { column: availableColumns[0] ?? "", op: "=", value: "" }]);
  }
  function updateFilter(i: number, patch: Partial<FilterRow>) {
    setFilters((f) => f.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeFilter(i: number) {
    setFilters((f) => f.filter((_, idx) => idx !== i));
  }

  async function handleRun() {
    if (!activeConnId || !activeSql) return;
    setRunning(true);
    try {
      const res = await api.executeQuery(activeConnId, activeSql, false);
      setResult(res);
    } finally {
      setRunning(false);
    }
  }

  function handleOpenInEditor() {
    if (!activeSql) return;
    sessionStorage.setItem("dbx_pending_sql", activeSql);
    router.push("/sql-editor");
  }

  // Removes everything the user configured — table, columns, filters,
  // order/limit and any manual SQL edits — plus the saved copy in storage,
  // so a refresh afterwards starts from a clean slate.
  function handleClearAll() {
    setTable("");
    setAvailableColumns([]);
    setSelectedColumns(new Set());
    setFilters([]);
    setOrderBy("");
    setOrderDir("asc");
    setLimit(100);
    setManualSql(null);
    setResult(null);
    setOpenKeywordGroup(null);
    clearPersistedQBState();
  }

  // Reverts manual SQL edits and goes back to following the builder above.
  function handleResetToBuilder() {
    setManualSql(null);
  }

  // Inserts a keyword/function snippet into the SQL box at the current
  // cursor position (or appends it if nothing is focused/selected yet).
  function insertKeyword(insertText: string) {
    const base = activeSql;
    const editorInst = editorRef.current;
    const model = editorInst?.getModel();
    const selection = editorInst && model ? editorInst.getSelection() : null;

    if (!editorInst || !model || !selection) {
      // Editor not mounted yet — fall back to a plain append.
      const needsLeadingSpace = base.length > 0 && !/\s$/.test(base) && !/^\s/.test(insertText) && !insertText.startsWith("\n");
      setManualSql(base + (needsLeadingSpace ? ` ${insertText}` : insertText));
      return;
    }

    const startPos = selection.getStartPosition();
    const before = model.getValueInRange({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: startPos.lineNumber,
      endColumn: startPos.column,
    });
    const needsLeadingSpace =
      before.length > 0 && !/\s$/.test(before) && !/^\s/.test(insertText) && !insertText.startsWith("\n");
    const piece = needsLeadingSpace ? ` ${insertText}` : insertText;

    editorInst.executeEdits("insert-keyword", [{ range: selection, text: piece, forceMoveMarkers: true }]);
    editorInst.focus();
    // onChange fires from executeEdits and keeps manualSql in sync.
  }

  const handleEditorMount: OnMount = (editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    monacoRef.current = monacoInstance;
    completionDisposableRef.current?.dispose();
    completionDisposableRef.current = registerSqlCompletionProvider(monacoInstance, {
      treeRef,
      activeConnIdRef,
      columnCacheRef,
    });
  };

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <div className="shrink-0 border-b border-border-glass dbx-glass px-5 py-2.5 flex items-center gap-3">
          <span className="text-xs text-text-muted">Connection:</span>
          {connections.length === 0 ? (
            <span className="text-xs text-text-faint">Belum ada koneksi database.</span>
          ) : (
            <div className="relative">
              <button
                onClick={() => setPickerOpen((o) => !o)}
                className="flex items-center gap-2 text-sm text-text bg-panel-2 border border-border-glass rounded-lg px-3 py-1.5 hover:border-border-glass-strong transition-colors"
              >
                <Plug size={13} className="text-cyan" />
                {activeConnection?.name ?? "Pilih koneksi"}
                <ChevronDown size={13} className="text-text-faint" />
              </button>
              {pickerOpen && (
                <div className="absolute top-full mt-1 left-0 dbx-glass-strong rounded-lg py-1 min-w-[220px] z-20">
                  {connections.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setActiveConnId(c.id);
                        setPickerOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-panel/60 transition-colors ${
                        c.id === activeConnId ? "text-cyan" : "text-text"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div ref={containerRef} className="flex-1 min-h-0 flex overflow-hidden relative">
          {/* Builder form */}
          {!sidebarCollapsed && (
            <div
              style={{ width: sidebarWidth }}
              className="shrink-0 border-r border-border-glass overflow-y-auto dbx-scrollbar p-4 space-y-5 relative"
            >
              <button
                onClick={toggleSidebarCollapsed}
                title="Ciutkan panel"
                className="absolute top-3 right-3 text-text-faint hover:text-cyan transition-colors z-10"
              >
                <ChevronLeft size={14} />
              </button>

              <div className="flex items-center justify-between pr-6">
                <span className="text-xs font-medium text-text-muted">Builder</span>
                <button
                  onClick={handleClearAll}
                  title="Hapus tabel, kolom, filter, dan SQL yang sudah diatur"
                  className="flex items-center gap-1 text-[10px] text-text-faint hover:text-danger transition-colors border border-border-glass rounded-lg px-2 py-1"
                >
                  <Eraser size={11} />
                  Clear All
                </button>
              </div>

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Schema</label>
              <select value={schema} onChange={(e) => setSchema(e.target.value)} className="dbx-input text-sm">
                {tree?.schemas.map((s) => (
                  <option key={s.schema} value={s.schema}>
                    {s.schema}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Table</label>
              <select value={table} onChange={(e) => setTable(e.target.value)} className="dbx-input text-sm">
                <option value="">— pilih tabel —</option>
                {currentSchemaTables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {table && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-text-muted">Columns</label>
                    <button
                      onClick={() => toggleAllColumns(availableColumns)}
                      className="text-[10px] text-cyan hover:underline"
                    >
                      {allColumnsSelected(availableColumns) ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  <p className="text-[10px] text-text-faint mb-1.5">{table}</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto dbx-scrollbar dbx-glass rounded-lg p-2">
                    {availableColumns.map((col) => (
                      <button
                        key={col}
                        onClick={() => toggleColumn(col)}
                        className="w-full flex items-center gap-2 text-xs text-text px-1.5 py-1 rounded hover:bg-panel/50"
                      >
                        {selectedColumns.has(col) ? (
                          <CheckSquare size={13} className="text-cyan shrink-0" />
                        ) : (
                          <Square size={13} className="text-text-faint shrink-0" />
                        )}
                        <span className="font-mono truncate">{col}</span>
                      </button>
                    ))}
                  </div>

                  {relatedTables.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {relatedTables.map((rt) => {
                        const values = rt.columns.map((c) => `${rt.table}.${c}`);
                        return (
                          <div key={rt.table}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] text-warning">{rt.table} (relasi)</span>
                              <button
                                onClick={() => toggleAllColumns(values)}
                                className="text-[10px] text-cyan hover:underline"
                              >
                                {allColumnsSelected(values) ? "Clear all" : "Select all"}
                              </button>
                            </div>
                            <div className="space-y-1 max-h-32 overflow-y-auto dbx-scrollbar dbx-glass rounded-lg p-2">
                              {rt.columns.map((col) => {
                                const value = `${rt.table}.${col}`;
                                return (
                                  <button
                                    key={value}
                                    onClick={() => toggleColumn(value)}
                                    className="w-full flex items-center gap-2 text-xs text-text px-1.5 py-1 rounded hover:bg-panel/50"
                                  >
                                    {selectedColumns.has(value) ? (
                                      <CheckSquare size={13} className="text-cyan shrink-0" />
                                    ) : (
                                      <Square size={13} className="text-text-faint shrink-0" />
                                    )}
                                    <span className="font-mono truncate">{col}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-[10px] text-text-faint">
                        Memilih kolom dari tabel relasi akan otomatis menambahkan JOIN — baris bisa bertambah
                        kalau relasinya satu-ke-banyak.
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-text-muted">Filters</label>
                    <button onClick={addFilter} className="flex items-center gap-1 text-[10px] text-cyan hover:underline">
                      <Plus size={11} /> Add
                    </button>
                  </div>
                  {relatedTables.length > 0 && (
                    <p className="text-[10px] text-text-faint mb-1.5">
                      Kolom dari {relatedTables.length} tabel berelasi (via FK di ERD) juga tersedia sebagai filter —
                      akan otomatis ditambahkan JOIN saat dipakai.
                    </p>
                  )}
                  <div className="space-y-2">
                    {filters.map((f, i) => (
                      <div key={i} className="dbx-glass rounded-lg p-2 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={f.column}
                            onChange={(e) => updateFilter(i, { column: e.target.value })}
                            className="dbx-input text-xs flex-1"
                          >
                            <optgroup label={table}>
                              {availableColumns.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </optgroup>
                            {relatedTables.map((rt) => (
                              <optgroup key={rt.table} label={`${rt.table} (relasi)`}>
                                {rt.columns.map((c) => (
                                  <option key={`${rt.table}.${c}`} value={`${rt.table}.${c}`}>
                                    {rt.table}.{c}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <button onClick={() => removeFilter(i)} className="text-text-faint hover:text-danger shrink-0">
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <select
                            value={f.op}
                            onChange={(e) => updateFilter(i, { op: e.target.value })}
                            className="dbx-input text-xs w-28 shrink-0"
                          >
                            {opsForDbType(activeConnection?.db_type).map((op) => (
                              <option key={op} value={op}>
                                {op}
                              </option>
                            ))}
                          </select>
                          {f.op !== "IS NULL" && f.op !== "IS NOT NULL" && (
                            <input
                              value={f.value}
                              onChange={(e) => updateFilter(i, { value: e.target.value })}
                              placeholder="value"
                              className="dbx-input text-xs flex-1"
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1.5">Order By</label>
                    <select value={orderBy} onChange={(e) => setOrderBy(e.target.value)} className="dbx-input text-xs">
                      <option value="">—</option>
                      {availableColumns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1.5">Direction</label>
                    <select
                      value={orderDir}
                      onChange={(e) => setOrderDir(e.target.value as "asc" | "desc")}
                      disabled={!orderBy}
                      className="dbx-input text-xs disabled:opacity-40"
                    >
                      <option value="asc">ASC</option>
                      <option value="desc">DESC</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">Limit</label>
                  <input
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="dbx-input text-sm"
                  />
                </div>
              </>
            )}
            </div>
          )}

          {!sidebarCollapsed ? (
            <div
              onMouseDown={startResize}
              title="Geser untuk mengatur lebar panel"
              className="w-1.5 shrink-0 cursor-col-resize hover:bg-cyan/40 active:bg-cyan/60 transition-colors"
            />
          ) : (
            <button
              onClick={toggleSidebarCollapsed}
              title="Tampilkan panel builder"
              className="shrink-0 w-6 border-r border-border-glass flex items-center justify-center text-text-faint hover:text-cyan hover:bg-panel/40 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          )}

          {/* SQL preview + results */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="shrink-0 border-b border-border-glass p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-text-muted">Generated SQL</label>
                  {manualSql !== null && (
                    <button
                      onClick={handleResetToBuilder}
                      title="Kembalikan ke hasil builder (buang perubahan manual)"
                      className="flex items-center gap-1 text-[10px] text-warning hover:underline"
                    >
                      <RotateCcw size={10} />
                      diedit manual · reset ke builder
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenInEditor}
                    disabled={!activeSql}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text border border-border-glass rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
                  >
                    <ExternalLink size={12} />
                    Open in SQL Editor
                  </button>
                  <button
                    onClick={handleRun}
                    disabled={!activeSql || running}
                    className="flex items-center gap-1.5 text-xs bg-gradient-to-r from-cyan to-blue text-void font-medium rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity disabled:opacity-40 dbx-glow-cyan"
                  >
                    {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    Run
                  </button>
                </div>
              </div>

              {/* Grouped keyword/function insert toolbar */}
              <div className="flex items-center gap-1 flex-wrap mb-2">
                <span className="flex items-center gap-1 text-[10px] text-text-faint mr-1">
                  <Sparkles size={10} className="text-violet" />
                  Insert:
                </span>
                {SQL_KEYWORD_GROUPS.map((group) => (
                  <div key={group.id} className="relative">
                    <button
                      onClick={() => setOpenKeywordGroup((g) => (g === group.id ? null : group.id))}
                      className={`flex items-center gap-1 text-[10px] rounded-full px-2 py-1 border transition-colors ${
                        openKeywordGroup === group.id
                          ? "border-cyan/40 text-cyan bg-cyan/10"
                          : "border-border-glass text-text-muted hover:text-text"
                      }`}
                    >
                      {group.label}
                      {openKeywordGroup === group.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    </button>
                    {openKeywordGroup === group.id && (
                      <div className="absolute top-full mt-1 left-0 z-30 dbx-glass-strong rounded-lg p-2 w-64 max-h-56 overflow-y-auto dbx-scrollbar grid grid-cols-2 gap-1">
                        {group.items.map((item) => (
                          <button
                            key={item.token}
                            onClick={() => insertKeyword(item.insertText)}
                            title={item.description}
                            className="text-left text-[10px] font-mono text-text px-1.5 py-1 rounded hover:bg-panel/60 hover:text-cyan truncate"
                          >
                            {item.token}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="w-full dbx-glass rounded-lg overflow-hidden h-32 resize-y min-h-[8rem] focus-within:ring-1 focus-within:ring-cyan/40">
                <Editor
                  height="100%"
                  language="sql"
                  theme="vs-dark"
                  value={activeSql}
                  onChange={(value) => setManualSql(value ?? "")}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: "off",
                    folding: false,
                    glyphMargin: false,
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    padding: { top: 10, bottom: 10 },
                    renderLineHighlight: "none",
                    quickSuggestions: true,
                    suggestOnTriggerCharacters: true,
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0">
              {result ? (
                result.success ? (
                  <QueryResultGrid columns={result.columns} rows={result.rows} connectionId={activeConnId ?? undefined} sql={activeSql} />
                ) : (
                  <div className="p-5">
                    <div className="dbx-glass rounded-lg border-danger/30 p-4">
                      <p className="text-xs uppercase tracking-wide text-danger mb-2">SQL Error</p>
                      <pre className="text-xs font-mono text-text whitespace-pre-wrap">{result.error}</pre>
                    </div>
                  </div>
                )
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-text-faint">
                  Pilih tabel, atur kolom/filter, lalu klik Run untuk melihat hasilnya.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
