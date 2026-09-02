"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronDown, Plug, Plus, FileSpreadsheet, Database } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DatabaseExplorerTree, SelectedTable } from "@/components/DatabaseExplorerTree";
import { TableViewer } from "@/components/TableViewer";
import { CreateTableModal } from "@/components/CreateTableModal";
import { ImportExcelModal } from "@/components/ImportExcelModal";
import { api, Connection, SchemaTree } from "@/lib/api";
import Link from "next/link";

export default function ExplorerPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [databases, setDatabases] = useState<{ name: string; size: string | null }[]>([]);
  const [activeDatabase, setActiveDatabase] = useState<string | null>(null);
  const [dbPickerOpen, setDbPickerOpen] = useState(false);
  const [tree, setTree] = useState<SchemaTree | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [selected, setSelected] = useState<SelectedTable | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showImportExcel, setShowImportExcel] = useState(false);

  useEffect(() => {
    api.listConnections().then((cs) => {
      setConnections(cs);
      if (cs.length > 0) setActiveId(cs[0].id);
    }).catch(() => {});
  }, []);

  const loadTree = useCallback(
    (forceRefresh = false) => {
      if (!activeId) return;
      setLoadingTree(true);
      const database = activeDatabase ?? undefined;
      const p = forceRefresh
        ? api.refreshMetadata(activeId, database)
        : api.getSchemas(activeId, database);
      p.then(setTree)
        .catch(() => setTree(null))
        .finally(() => setLoadingTree(false));
    },
    [activeId, activeDatabase]
  );

  // Setiap kali koneksi aktif berganti, ambil daftar database di server
  // tersebut (mis. "pajak" dan "non_pajak" pada satu server yang sama)
  // supaya pengguna bisa memilih database mana yang mau dieksplorasi.
  useEffect(() => {
    setActiveDatabase(null);
    setDatabases([]);
    if (!activeId) return;
    api
      .listDatabases(activeId)
      .then((dbs) => {
        setDatabases(dbs);
        const conn = connections.find((c) => c.id === activeId);
        // Default ke database yang tersimpan di koneksi (kalau ada di daftar),
        // kalau tidak, ke database pertama yang ditemukan.
        const preferred =
          dbs.find((d) => d.name === conn?.database_name)?.name ?? dbs[0]?.name ?? null;
        setActiveDatabase(preferred);
      })
      .catch(() => setDatabases([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    setSelected(null);
    setTree(null);
    if (activeId) loadTree(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeDatabase]);

  const activeConnection = connections.find((c) => c.id === activeId);
  const supportsMultipleDatabases = activeConnection?.db_type !== "sqlite";

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <div className="shrink-0 border-b border-border-glass dbx-glass px-5 py-2.5 flex items-center gap-3">
          <span className="text-xs text-text-muted">Connection:</span>
          {connections.length === 0 ? (
            <Link href="/connections" className="text-xs text-cyan hover:underline">
              Tambahkan koneksi database terlebih dahulu →
            </Link>
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
                        setActiveId(c.id);
                        setPickerOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-panel/60 transition-colors ${
                        c.id === activeId ? "text-cyan" : "text-text"
                      }`}
                    >
                      {c.name}
                      <span className="block text-text-faint font-mono text-[10px]">
                        {c.database_name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeId && supportsMultipleDatabases && (
            <>
              <span className="text-xs text-text-muted">Database:</span>
              <div className="relative">
                <button
                  onClick={() => setDbPickerOpen((o) => !o)}
                  disabled={databases.length === 0}
                  className="flex items-center gap-2 text-sm text-text bg-panel-2 border border-border-glass rounded-lg px-3 py-1.5 hover:border-border-glass-strong transition-colors disabled:opacity-50"
                >
                  <Database size={13} className="text-violet" />
                  {activeDatabase ?? (databases.length === 0 ? "Memuat…" : "Pilih database")}
                  <ChevronDown size={13} className="text-text-faint" />
                </button>
                {dbPickerOpen && databases.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 dbx-glass-strong rounded-lg py-1 min-w-[200px] max-h-64 overflow-y-auto dbx-scrollbar z-20">
                    {databases.map((d) => (
                      <button
                        key={d.name}
                        onClick={() => {
                          setActiveDatabase(d.name);
                          setDbPickerOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-panel/60 transition-colors ${
                          d.name === activeDatabase ? "text-violet" : "text-text"
                        }`}
                      >
                        {d.name}
                        {d.size && (
                          <span className="block text-text-faint font-mono text-[10px]">{d.size}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {activeId && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowImportExcel(true)}
                className="flex items-center gap-1.5 text-xs text-blue border border-blue/30 rounded-lg px-2.5 py-1.5 hover:bg-blue/10 transition-colors"
              >
                <FileSpreadsheet size={13} />
                Import Excel
              </button>
              <button
                onClick={() => setShowCreateTable(true)}
                className="flex items-center gap-1.5 text-xs text-cyan border border-cyan/30 rounded-lg px-2.5 py-1.5 hover:bg-cyan/10 transition-colors"
              >
                <Plus size={13} />
                New Table
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex">
          <DatabaseExplorerTree
            tree={tree}
            loading={loadingTree}
            onSelect={setSelected}
            onRefresh={() => loadTree(true)}
            selected={selected}
          />
          <div className="flex-1 min-w-0">
            {selected && activeId ? (
              <TableViewer
                connectionId={activeId}
                database={activeDatabase ?? undefined}
                selected={selected}
                onTableDropped={() => {
                  setSelected(null);
                  loadTree(true);
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-text-faint">
                Pilih tabel atau view dari sidebar untuk melihat isinya.
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreateTable && activeId && (
        <CreateTableModal
          connectionId={activeId}
          database={activeDatabase ?? undefined}
          schema={selected?.schema ?? tree?.schemas[0]?.schema ?? "public"}
          onClose={() => setShowCreateTable(false)}
          onCreated={() => loadTree(true)}
        />
      )}

      {showImportExcel && activeId && (
        <ImportExcelModal
          connectionId={activeId}
          database={activeDatabase ?? undefined}
          schema={selected?.schema ?? tree?.schemas[0]?.schema ?? "public"}
          tree={tree}
          onClose={() => setShowImportExcel(false)}
          onImported={() => loadTree(true)}
        />
      )}
    </AppShell>
  );
}
