"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { OnMount, Monaco } from "@monaco-editor/react";
import { format as formatSql } from "sql-formatter";
import {
  Play,
  Save,
  Wand2,
  Plus,
  X,
  ChevronDown,
  Plug,
  History,
  BookMarked,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { QueryResultGrid } from "@/components/QueryResultGrid";
import { ConfirmDestructiveModal } from "@/components/ConfirmDestructiveModal";
import { SaveQueryModal } from "@/components/SaveQueryModal";
import {
  api,
  Connection,
  SchemaTree,
  QueryExecuteResult,
  QueryHistoryItem,
  SavedQueryItem,
} from "@/lib/api";
import { registerSqlCompletionProvider } from "@/lib/sql-completions";

interface QueryTab {
  id: string;
  title: string;
  sql: string;
  result: QueryExecuteResult | null;
  running: boolean;
  pendingWarning: string | null;
}

let tabCounter = 1;
function newTab(sql = ""): QueryTab {
  return { id: `tab-${tabCounter++}`, title: `Query ${tabCounter - 1}`, sql, result: null, running: false, pendingWarning: null };
}

// The very first tab is created during render (in the useState initializer
// below), which runs on both the server and the client. It must NOT use the
// shared module-level counter above — that counter can drift between a dev
// server's SSR pass and a Fast-Refreshed client bundle (its value persists
// across hot reloads), which produces a hydration text mismatch on the tab
// label. Give the initial tab a fixed id/title instead; only tabs created
// later by user interaction (addTab / loadIntoNewTab), which run exclusively
// on the client after mount, use the shared counter.
function initialTab(sql: string): QueryTab {
  return { id: "tab-initial", title: "Query 1", sql, result: null, running: false, pendingWarning: null };
}

export default function SqlEditorPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnId, setActiveConnId] = useState<string | null>(null);
  const [connPickerOpen, setConnPickerOpen] = useState(false);
  const [tree, setTree] = useState<SchemaTree | null>(null);

  const [tabs, setTabs] = useState<QueryTab[]>([initialTab("SELECT * FROM ")]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);

  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<"history" | "saved">("history");
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [savedQueries, setSavedQueries] = useState<SavedQueryItem[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);

  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const columnCacheRef = useRef<Record<string, { name: string; type: string }[]>>({});
  const activeConnIdRef = useRef<string | null>(null);
  const treeRef = useRef<SchemaTree | null>(null);
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId)!;
  const activeConnection = connections.find((c) => c.id === activeConnId);

  useEffect(() => {
    activeConnIdRef.current = activeConnId;
  }, [activeConnId]);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  // Dispose the completion provider when this page unmounts — Monaco is a
  // singleton across client-side navigations, so leaving it registered
  // would keep suggesting after the user leaves this page, and stack a
  // duplicate provider if they come back.
  useEffect(() => {
    return () => completionDisposableRef.current?.dispose();
  }, []);

  useEffect(() => {
    api.listConnections().then((cs) => {
      setConnections(cs);
      if (cs.length > 0) setActiveConnId(cs[0].id);
    }).catch(() => {});
  }, []);

  // Pick up SQL handed off from the Query Builder, if any.
  useEffect(() => {
    const pending = sessionStorage.getItem("dbx_pending_sql");
    if (pending) {
      sessionStorage.removeItem("dbx_pending_sql");
      loadIntoNewTab(pending, "From Builder");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeConnId) return;
    api.getSchemas(activeConnId).then(setTree).catch(() => {});
    columnCacheRef.current = {};
    refreshHistory();
    refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnId]);

  function refreshHistory() {
    if (!activeConnIdRef.current) return;
    api.getQueryHistory(activeConnIdRef.current, 50).then(setHistory).catch(() => {});
  }
  function refreshSaved() {
    if (!activeConnIdRef.current) return;
    api.listSavedQueries(activeConnIdRef.current).then(setSavedQueries).catch(() => {});
  }

  function updateTab(id: string, patch: Partial<QueryTab>) {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addTab() {
    const t = newTab("");
    setTabs((ts) => [...ts, t]);
    setActiveTabId(t.id);
  }

  function closeTab(id: string) {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = newTab("");
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (activeTabId === id) setActiveTabId(next[next.length - 1].id);
      return next;
    });
  }

  const runQuery = useCallback(
    async (confirmDestructive = false) => {
      if (!activeConnId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || !tab.sql.trim()) return;
      updateTab(tab.id, { running: true, pendingWarning: null });
      try {
        const res = await api.executeQuery(activeConnId, tab.sql, confirmDestructive);
        if (res.requires_confirmation) {
          updateTab(tab.id, { running: false, pendingWarning: res.warning ?? "Operasi ini berpotensi merusak data." });
          return;
        }
        updateTab(tab.id, { running: false, result: res });
        refreshHistory();
      } catch {
        updateTab(tab.id, { running: false });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeConnId, activeTabId, tabs]
  );

  function loadIntoNewTab(sql: string, title = "Query") {
    const t = { ...newTab(sql), title };
    setTabs((ts) => [...ts, t]);
    setActiveTabId(t.id);
  }

  // sql-formatter has a dedicated dialect per engine — feeding it the
  // wrong one doesn't error, but it mis-formats engine-specific syntax
  // (e.g. MySQL backtick identifiers, SQLite pragmas). Map our db_type to
  // the matching sql-formatter language.
  function formatterLanguage(dbType: string | undefined): Parameters<typeof formatSql>[1]["language"] {
    if (dbType === "mysql") return "mysql";
    if (dbType === "mariadb") return "mariadb";
    if (dbType === "sqlite") return "sqlite";
    return "postgresql";
  }

  function handleFormat() {
    try {
      const formatted = formatSql(activeTab.sql, { language: formatterLanguage(activeConnection?.db_type) });
      updateTab(activeTab.id, { sql: formatted });
    } catch {
      /* ignore formatting errors on invalid partial SQL */
    }
  }

  // --- Monaco setup: keybindings + autocomplete ---
  const handleEditorMount: OnMount = (editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    monacoRef.current = monacoInstance;

    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      runQuery(false);
    });
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      setShowSaveModal(true);
    });
    editorInstance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyF,
      () => handleFormat()
    );

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
        {/* Top bar: connection picker + actions */}
        <div className="shrink-0 border-b border-border-glass dbx-glass px-5 py-2.5 flex items-center gap-3">
          <span className="text-xs text-text-muted">Connection:</span>
          {connections.length === 0 ? (
            <span className="text-xs text-text-faint">Belum ada koneksi database.</span>
          ) : (
            <div className="relative">
              <button
                onClick={() => setConnPickerOpen((o) => !o)}
                className="flex items-center gap-2 text-sm text-text bg-panel-2 border border-border-glass rounded-lg px-3 py-1.5 hover:border-border-glass-strong transition-colors"
              >
                <Plug size={13} className="text-cyan" />
                {activeConnection?.name ?? "Pilih koneksi"}
                <ChevronDown size={13} className="text-text-faint" />
              </button>
              {connPickerOpen && (
                <div className="absolute top-full mt-1 left-0 dbx-glass-strong rounded-lg py-1 min-w-[220px] z-20">
                  {connections.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setActiveConnId(c.id);
                        setConnPickerOpen(false);
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

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => runQuery(false)}
              disabled={!activeConnId || activeTab.running || !activeTab.sql.trim()}
              suppressHydrationWarning
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-xs py-1.5 px-3 hover:opacity-90 transition-opacity disabled:opacity-40 dbx-glow-cyan"
            >
              {activeTab.running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Run
              <span className="text-[10px] opacity-70 font-mono">Ctrl+Enter</span>
            </button>
            <button
              onClick={handleFormat}
              className="flex items-center gap-1.5 rounded-lg border border-border-glass text-text-muted hover:text-text text-xs py-1.5 px-3 transition-colors"
            >
              <Wand2 size={13} />
              Format
            </button>
            <button
              onClick={() => setShowSaveModal(true)}
              disabled={!activeTab.sql.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-border-glass text-text-muted hover:text-text text-xs py-1.5 px-3 transition-colors disabled:opacity-40"
            >
              <Save size={13} />
              Save
            </button>
            <button
              onClick={() => setPanelOpen((o) => !o)}
              title={panelOpen ? "Sembunyikan panel" : "Tampilkan panel"}
              className="text-text-faint hover:text-text transition-colors p-1.5"
            >
              {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>
          </div>
        </div>

        {/* Tabs bar */}
        <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-border-glass overflow-x-auto dbx-scrollbar">
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => setActiveTabId(t.id)}
              className={`flex items-center gap-2 text-xs rounded-lg px-3 py-1.5 cursor-pointer shrink-0 transition-colors ${
                t.id === activeTabId
                  ? "bg-panel-2 text-text border border-border-glass-strong"
                  : "text-text-muted hover:text-text hover:bg-panel/40"
              }`}
            >
              <span>{t.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                className="text-text-faint hover:text-danger"
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <button
            onClick={addTab}
            className="flex items-center justify-center h-7 w-7 rounded-lg text-text-faint hover:text-cyan hover:bg-panel/40 transition-colors shrink-0"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Main area: editor+results | side panel */}
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="h-[42%] min-h-[160px] border-b border-border-glass">
              <Editor
                height="100%"
                language="sql"
                theme="vs-dark"
                value={activeTab.sql}
                onChange={(val) => updateTab(activeTab.id, { sql: val ?? "" })}
                onMount={handleEditorMount}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  fontFamily:
                    "ui-monospace, Cascadia Code, JetBrains Mono, SFMono-Regular, Consolas, monospace",
                  scrollBeyondLastLine: false,
                  padding: { top: 12 },
                }}
              />
            </div>

            <div className="flex-1 min-h-0">
              {activeTab.pendingWarning ? (
                <ConfirmDestructiveModal
                  warning={activeTab.pendingWarning}
                  onConfirm={() => runQuery(true)}
                  onCancel={() => updateTab(activeTab.id, { pendingWarning: null })}
                />
              ) : null}

              {activeTab.result ? (
                activeTab.result.success ? (
                  <div className="h-full flex flex-col">
                    <div className="shrink-0 px-4 py-1.5 text-xs text-text-faint border-b border-border-glass flex items-center gap-3">
                      <span className="text-success">SUCCESS</span>
                      <span>{activeTab.result.row_count.toLocaleString("id-ID")} rows</span>
                      <span>{activeTab.result.duration_ms.toLocaleString("id-ID")}ms</span>
                    </div>
                    <div className="flex-1 min-h-0">
                      <QueryResultGrid
                        columns={activeTab.result.columns}
                        rows={activeTab.result.rows}
                        connectionId={activeConnId ?? undefined}
                        sql={activeTab.sql}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="p-5">
                    <div className="dbx-glass rounded-lg border-danger/30 p-4">
                      <p className="text-xs uppercase tracking-wide text-danger mb-2">SQL Error</p>
                      <pre className="text-xs font-mono text-text whitespace-pre-wrap">{activeTab.result.error}</pre>
                    </div>
                  </div>
                )
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-text-faint">
                  Tulis SQL lalu tekan Run (Ctrl+Enter) untuk melihat hasilnya.
                </div>
              )}
            </div>
          </div>

          {panelOpen && (
            <div className="w-72 shrink-0 border-l border-border-glass dbx-glass flex flex-col">
              <div className="flex border-b border-border-glass">
                <button
                  onClick={() => setPanelTab("history")}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2.5 transition-colors ${
                    panelTab === "history" ? "text-cyan border-b-2 border-cyan" : "text-text-muted"
                  }`}
                >
                  <History size={13} />
                  History
                </button>
                <button
                  onClick={() => setPanelTab("saved")}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2.5 transition-colors ${
                    panelTab === "saved" ? "text-cyan border-b-2 border-cyan" : "text-text-muted"
                  }`}
                >
                  <BookMarked size={13} />
                  Saved
                </button>
              </div>

              <div className="flex-1 overflow-auto dbx-scrollbar p-2">
                {panelTab === "history" ? (
                  history.length === 0 ? (
                    <p className="text-xs text-text-faint p-3">Belum ada riwayat query.</p>
                  ) : (
                    history.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => loadIntoNewTab(h.sql, "History")}
                        className="w-full text-left rounded-lg p-2.5 mb-1.5 hover:bg-panel/50 transition-colors"
                      >
                        <p className="text-[11px] font-mono text-text truncate">{h.sql}</p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-text-faint">
                          <span className={h.status === "success" ? "text-success" : "text-danger"}>
                            {h.status}
                          </span>
                          <span>{h.duration_ms.toLocaleString("id-ID")}ms</span>
                          <span>{new Date(h.executed_at).toLocaleTimeString("id-ID")}</span>
                        </div>
                      </button>
                    ))
                  )
                ) : savedQueries.length === 0 ? (
                  <p className="text-xs text-text-faint p-3">Belum ada saved query.</p>
                ) : (
                  savedQueries.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => loadIntoNewTab(q.sql, q.name)}
                      className="w-full text-left rounded-lg p-2.5 mb-1.5 hover:bg-panel/50 transition-colors"
                    >
                      <p className="text-xs text-text truncate">{q.name}</p>
                      {q.category && <p className="text-[10px] text-violet mt-0.5">{q.category}</p>}
                      <p className="text-[11px] font-mono text-text-faint truncate mt-1">{q.sql}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showSaveModal && (
        <SaveQueryModal
          sql={activeTab.sql}
          connectionId={activeConnId}
          onClose={() => setShowSaveModal(false)}
          onSaved={refreshSaved}
        />
      )}
    </AppShell>
  );
}
