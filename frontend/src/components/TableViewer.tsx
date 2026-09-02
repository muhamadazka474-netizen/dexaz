"use client";

import { useEffect, useState, useCallback } from "react";
import { Table2, Eye, Trash2 } from "lucide-react";
import { DynamicDataGrid } from "./DynamicDataGrid";
import { GridFilter } from "./FilterBar";
import { RowFormModal, ColumnMeta } from "./RowFormModal";
import { api, TableData, ApiError, exportApi, exportRowsClientSide, downloadBlob } from "@/lib/api";
import { SelectedTable } from "./DatabaseExplorerTree";

type Tab = "data" | "structure" | "relations" | "indexes";

export function TableViewer({
  connectionId,
  database,
  selected,
  onTableDropped,
}: {
  connectionId: string;
  database?: string;
  selected: SelectedTable;
  onTableDropped?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("data");
  const [dropping, setDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => setTab("data"), [selected.schema, selected.table]);

  async function handleDropTable() {
    if (selected.kind !== "table") return;
    const ok = window.confirm(
      `Yakin ingin menghapus tabel "${selected.schema}.${selected.table}"? Semua data di dalamnya akan hilang secara permanen.`
    );
    if (!ok) return;
    setDropping(true);
    setDropError(null);
    try {
      const sql = `DROP TABLE "${selected.schema}"."${selected.table}";`;
      const res = await api.executeQuery(connectionId, sql, true, database);
      if (res.success) onTableDropped?.();
      else setDropError(res.error ?? "Gagal menghapus tabel");
    } catch (e) {
      setDropError(e instanceof ApiError ? e.message : "Gagal menghapus tabel");
    } finally {
      setDropping(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-border-glass px-5 py-3 dbx-glass">
        <div className="flex items-center gap-2">
          {selected.kind === "view" ? (
            <Eye size={15} className="text-violet" />
          ) : (
            <Table2 size={15} className="text-cyan" />
          )}
          <span className="font-display text-sm text-text">{selected.table}</span>
          <span className="text-xs text-text-faint font-mono">{selected.schema}</span>

          {selected.kind === "table" && (
            <button
              onClick={handleDropTable}
              disabled={dropping}
              title="Drop table"
              className="ml-auto flex items-center gap-1.5 text-xs text-danger border border-danger/30 rounded-lg px-2.5 py-1 hover:bg-danger/10 transition-colors disabled:opacity-40"
            >
              <Trash2 size={12} />
              {dropping ? "Menghapus…" : "Drop Table"}
            </button>
          )}
        </div>
        {dropError && <p className="text-xs text-danger mt-2">{dropError}</p>}
        <div className="flex items-center gap-1 mt-3">
          {(["data", "structure", "relations", "indexes"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs capitalize px-3 py-1.5 rounded-lg transition-colors ${
                tab === t
                  ? "bg-panel-2 text-text border border-border-glass-strong"
                  : "text-text-muted hover:text-text hover:bg-panel/40"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {tab === "data" && <DataTab connectionId={connectionId} database={database} selected={selected} />}
        {tab === "structure" && <StructureTab connectionId={connectionId} database={database} selected={selected} />}
        {tab === "relations" && <RelationsTab connectionId={connectionId} database={database} selected={selected} />}
        {tab === "indexes" && <IndexesTab connectionId={connectionId} database={database} selected={selected} />}
      </div>
    </div>
  );
}

function DataTab({ connectionId, database, selected }: { connectionId: string; database?: string; selected: SelectedTable }) {
  const [data, setData] = useState<TableData | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [loading, setLoading] = useState(true);
  const [sortColumn, setSortColumn] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<GridFilter[]>([]);
  const [columnMeta, setColumnMeta] = useState<ColumnMeta[]>([]);
  const [primaryKeys, setPrimaryKeys] = useState<string[]>([]);
  const [structureLoaded, setStructureLoaded] = useState(false);
  const [formState, setFormState] = useState<{ mode: "add" | "edit"; row?: Record<string, unknown> } | null>(null);
  const [rowToDelete, setRowToDelete] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkDelete, setBulkDelete] = useState<{
    rows: Record<string, unknown>[];
    clearSelection: () => void;
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getTableData(connectionId, selected.schema, selected.table, page, pageSize, sortColumn, sortDir, filters, database)
      .then(setData)
      .finally(() => setLoading(false));
  }, [connectionId, database, selected.schema, selected.table, page, pageSize, sortColumn, sortDir, filters]);

  useEffect(() => {
    setPage(1);
    setSortColumn(undefined);
    setFilters([]);
    setStructureLoaded(false);
    if (selected.kind === "table") {
      api.getTableStructure(connectionId, selected.schema, selected.table, database).then((s) => {
        setColumnMeta(s.columns);
        setPrimaryKeys(s.primary_keys.map((p) => p.column_name));
        setStructureLoaded(true);
      }).catch(() => {
        setColumnMeta([]);
        setPrimaryKeys([]);
        setStructureLoaded(true);
      });
    } else {
      setColumnMeta([]);
      setPrimaryKeys([]);
      setStructureLoaded(true);
    }
  }, [connectionId, database, selected.schema, selected.table, selected.kind]);

  useEffect(load, [load]);

  const isTable = selected.kind === "table";
  const canEditOrDeleteRows = isTable && primaryKeys.length > 0;

  async function confirmDelete() {
    if (!rowToDelete) return;
    setDeleting(true);
    try {
      const pk: Record<string, unknown> = {};
      for (const col of primaryKeys) pk[col] = rowToDelete[col];
      await api.deleteRow(connectionId, selected.schema, selected.table, pk, database);
      setRowToDelete(null);
      load();
    } finally {
      setDeleting(false);
    }
  }

  async function confirmBulkDelete() {
    if (!bulkDelete) return;
    setBulkDeleting(true);
    setBulkDeleteError(null);
    try {
      // Rows are deleted one request at a time (there's no bulk-delete
      // endpoint) but concurrently, since each targets its own primary key
      // and there's no ordering dependency between them.
      const results = await Promise.allSettled(
        bulkDelete.rows.map((row) => {
          const pk: Record<string, unknown> = {};
          for (const col of primaryKeys) pk[col] = row[col];
          return api.deleteRow(connectionId, selected.schema, selected.table, pk, database);
        })
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      bulkDelete.clearSelection();
      setBulkDelete(null);
      load();
      if (failed > 0) {
        setBulkDeleteError(`${failed} dari ${results.length} baris gagal dihapus.`);
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  function handleExportCurrent(format: "csv" | "json" | "excel") {
    if (!data) return;
    if (format !== "excel") {
      exportRowsClientSide(data.columns, data.rows, format, selected.table);
      return;
    }
    setExporting(true);
    exportApi
      .exportTable({
        connectionId,
        schema: selected.schema,
        table: selected.table,
        format: "excel",
        scope: "current_page",
        page,
        limit: pageSize,
        sortColumn: sortColumn,
        sortDir,
        filters,
        database,
      })
      .then(({ blob, filename }) => downloadBlob(blob, filename))
      .finally(() => setExporting(false));
  }

  function handleExportAll(format: "csv" | "json" | "excel") {
    setExporting(true);
    exportApi
      .exportTable({ connectionId, schema: selected.schema, table: selected.table, format, scope: "all", database })
      .then(({ blob, filename }) => downloadBlob(blob, filename))
      .finally(() => setExporting(false));
  }

  return (
    <div className="flex flex-col h-full">
      {structureLoaded && selected.kind === "table" && primaryKeys.length === 0 && (
        <div className="shrink-0 px-4 py-2 text-xs text-warning bg-warning/10 border-b border-warning/20">
          Tabel ini tidak memiliki primary key yang terdeteksi, sehingga tombol Edit/Delete Row
          dinonaktifkan (agar tidak salah menargetkan baris). Add Row tetap tersedia.
        </div>
      )}
      <div className="flex-1 min-h-0">
        <DynamicDataGrid
        columns={data?.columns ?? []}
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        loading={loading}
        sortColumn={sortColumn}
        sortDir={sortDir}
        onSortChange={(col, dir) => {
          setSortColumn(dir ? col : undefined);
          setSortDir(dir ?? "asc");
          setPage(1);
        }}
        filters={filters}
        onFiltersChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
        onRefresh={load}
        onAddRow={isTable && structureLoaded ? () => setFormState({ mode: "add" }) : undefined}
        onEditRow={canEditOrDeleteRows ? (row) => setFormState({ mode: "edit", row }) : undefined}
        onDeleteRow={canEditOrDeleteRows ? (row) => setRowToDelete(row) : undefined}
        onDeleteSelected={
          canEditOrDeleteRows ? (rows, clearSelection) => setBulkDelete({ rows, clearSelection }) : undefined
        }
        onExportCurrent={isTable ? handleExportCurrent : undefined}
        onExportAll={isTable ? handleExportAll : undefined}
        exporting={exporting}
        />
      </div>

      {formState && (
        <RowFormModal
          connectionId={connectionId}
          database={database}
          schema={selected.schema}
          table={selected.table}
          columns={columnMeta}
          primaryKeyColumns={primaryKeys}
          mode={formState.mode}
          initialValues={formState.row}
          onClose={() => setFormState(null)}
          onSaved={load}
        />
      )}

      {rowToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="dbx-glass-strong rounded-2xl w-full max-w-sm p-6">
            <h2 className="font-display text-base text-text mb-2">Hapus baris ini?</h2>
            <p className="text-sm text-text-muted mb-5">Tindakan ini tidak dapat dibatalkan.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 rounded-lg bg-danger/90 hover:bg-danger text-void font-medium text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {deleting ? "Menghapus…" : "Delete"}
              </button>
              <button
                onClick={() => setRowToDelete(null)}
                className="rounded-lg border border-border-glass text-text-muted hover:text-text text-sm py-2.5 px-4 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="dbx-glass-strong rounded-2xl w-full max-w-sm p-6">
            <h2 className="font-display text-base text-text mb-2">
              Hapus {bulkDelete.rows.length} baris terpilih?
            </h2>
            <p className="text-sm text-text-muted mb-5">Tindakan ini tidak dapat dibatalkan.</p>
            {bulkDeleteError && (
              <p className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2 mb-4">
                {bulkDeleteError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={confirmBulkDelete}
                disabled={bulkDeleting}
                className="flex-1 rounded-lg bg-danger/90 hover:bg-danger text-void font-medium text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {bulkDeleting ? "Menghapus…" : `Delete ${bulkDelete.rows.length}`}
              </button>
              <button
                onClick={() => {
                  setBulkDelete(null);
                  setBulkDeleteError(null);
                }}
                disabled={bulkDeleting}
                className="rounded-lg border border-border-glass text-text-muted hover:text-text text-sm py-2.5 px-4 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StructureTab({
  connectionId,
  database,
  selected,
}: {
  connectionId: string;
  database?: string;
  selected: SelectedTable;
}) {
  const [structure, setStructure] = useState<Awaited<ReturnType<typeof api.getTableStructure>> | null>(null);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newCol, setNewCol] = useState({ name: "", type: "VARCHAR(255)", notNull: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.getTableStructure(connectionId, selected.schema, selected.table, database).then(setStructure).catch(() => {});
  }

  useEffect(reload, [connectionId, database, selected.schema, selected.table]);

  async function handleAddColumn() {
    if (!newCol.name.trim()) return;
    setBusy(true);
    setError(null);
    const sql = `ALTER TABLE "${selected.schema}"."${selected.table}" ADD COLUMN "${newCol.name.trim()}" ${newCol.type}${newCol.notNull ? " NOT NULL" : ""};`;
    try {
      const res = await api.executeQuery(connectionId, sql, true, database);
      if (!res.success) {
        setError(res.error ?? "Gagal menambah kolom");
        return;
      }
      setShowAddColumn(false);
      setNewCol({ name: "", type: "VARCHAR(255)", notNull: false });
      reload();
    } finally {
      setBusy(false);
    }
  }

  if (!structure) return <EmptyState text="Memuat struktur…" />;

  const pkCols = new Set(structure.primary_keys.map((p) => p.column_name));

  return (
    <div className="p-5 overflow-auto h-full dbx-scrollbar">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setShowAddColumn((v) => !v)}
          className="text-xs text-cyan border border-cyan/30 rounded-lg px-2.5 py-1.5 hover:bg-cyan/10 transition-colors"
        >
          + Add Column
        </button>
      </div>

      {showAddColumn && (
        <div className="dbx-glass rounded-lg p-3 mb-4 space-y-2.5">
          <input
            value={newCol.name}
            onChange={(e) => setNewCol((c) => ({ ...c, name: e.target.value }))}
            placeholder="column_name"
            className="dbx-input text-sm font-mono w-full"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={newCol.type}
              onChange={(e) => setNewCol((c) => ({ ...c, type: e.target.value }))}
              className="dbx-input text-xs w-40 shrink-0"
            >
              {["VARCHAR(255)", "TEXT", "INTEGER", "BIGINT", "NUMERIC(15,2)", "BOOLEAN", "DATE", "TIMESTAMP", "JSON"].map(
                (t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                )
              )}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0">
              <input
                type="checkbox"
                checked={newCol.notNull}
                onChange={(e) => setNewCol((c) => ({ ...c, notNull: e.target.checked }))}
              />
              NOT NULL
            </label>
            <button
              onClick={handleAddColumn}
              disabled={busy || !newCol.name.trim()}
              className="ml-auto text-xs bg-cyan text-void rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2 mb-4">
          {error}
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-muted text-xs uppercase tracking-wide border-b border-border-glass">
            <th className="py-2 pr-4">Column</th>
            <th className="py-2 pr-4">Type</th>
            <th className="py-2 pr-4">Nullable</th>
            <th className="py-2 pr-4">Default</th>
            <th className="py-2">Key</th>
          </tr>
        </thead>
        <tbody>
          {structure.columns.map((c) => (
            <tr key={c.name} className="border-b border-border-glass/60">
              <td className="py-2 pr-4 font-mono text-text">{c.name}</td>
              <td className="py-2 pr-4 font-mono text-text-muted">
                {c.type}
                {c.max_length ? `(${c.max_length})` : ""}
              </td>
              <td className="py-2 pr-4 text-text-muted">{c.nullable ? "YES" : "NOT NULL"}</td>
              <td className="py-2 pr-4 font-mono text-text-faint truncate max-w-[200px]">
                {c.default_value ?? "—"}
              </td>
              <td className="py-2">
                {pkCols.has(c.name) && (
                  <span className="text-[10px] uppercase tracking-wide text-cyan border border-cyan/30 rounded px-1.5 py-0.5">
                    PK
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RelationsTab({ connectionId, database, selected }: { connectionId: string; database?: string; selected: SelectedTable }) {
  const [relations, setRelations] = useState<Awaited<ReturnType<typeof api.getTableRelations>> | null>(null);

  useEffect(() => {
    api.getTableRelations(connectionId, selected.schema, selected.table, database).then(setRelations).catch(() => {});
  }, [connectionId, database, selected.schema, selected.table]);

  if (!relations) return <EmptyState text="Memuat relasi…" />;
  if (relations.foreign_keys.length === 0)
    return <EmptyState text="Tabel ini tidak memiliki foreign key." />;

  return (
    <div className="p-5 overflow-auto h-full dbx-scrollbar space-y-3">
      {relations.foreign_keys.map((fk) => (
        <div key={fk.constraint_name} className="dbx-glass rounded-lg p-4 text-sm">
          <div className="flex items-center gap-2 font-mono text-text">
            <span className="text-cyan">
              {selected.table}.{fk.column_name}
            </span>
            <span className="text-text-faint">→</span>
            <span className="text-violet">
              {fk.referenced_table}.{fk.referenced_column}
            </span>
          </div>
          <p className="text-xs text-text-faint mt-1.5">{fk.constraint_name}</p>
        </div>
      ))}
    </div>
  );
}

function IndexesTab({ connectionId, database, selected }: { connectionId: string; database?: string; selected: SelectedTable }) {
  const [indexes, setIndexes] = useState<Awaited<ReturnType<typeof api.getTableIndexes>> | null>(null);

  useEffect(() => {
    api.getTableIndexes(connectionId, selected.schema, selected.table, database).then(setIndexes).catch(() => {});
  }, [connectionId, database, selected.schema, selected.table]);

  if (!indexes) return <EmptyState text="Memuat index…" />;
  if (indexes.length === 0) return <EmptyState text="Tabel ini tidak memiliki index." />;

  return (
    <div className="p-5 overflow-auto h-full dbx-scrollbar">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-muted text-xs uppercase tracking-wide border-b border-border-glass">
            <th className="py-2 pr-4">Index Name</th>
            <th className="py-2 pr-4">Columns</th>
            <th className="py-2 pr-4">Unique</th>
            <th className="py-2">Size</th>
          </tr>
        </thead>
        <tbody>
          {indexes.map((idx) => (
            <tr key={idx.index_name} className="border-b border-border-glass/60">
              <td className="py-2 pr-4 font-mono text-text">{idx.index_name}</td>
              <td className="py-2 pr-4 font-mono text-text-muted">{idx.columns}</td>
              <td className="py-2 pr-4 text-text-muted">{idx.is_unique ? "YES" : "NO"}</td>
              <td className="py-2 text-text-faint">{idx.size ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-text-faint">{text}</div>
  );
}
