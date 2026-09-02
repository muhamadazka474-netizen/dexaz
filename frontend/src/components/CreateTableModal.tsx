"use client";

import { useState } from "react";
import { X, Plus, Trash2, Play, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface ColumnDraft {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
}

const COMMON_TYPES = [
  "SERIAL", "BIGSERIAL", "INTEGER", "BIGINT", "NUMERIC(15,2)", "REAL",
  "VARCHAR(255)", "TEXT", "BOOLEAN", "DATE", "TIMESTAMP", "JSON", "UUID",
];

function emptyColumn(): ColumnDraft {
  return { name: "", type: "VARCHAR(255)", nullable: true, primaryKey: false, defaultValue: "" };
}

function buildCreateTableSql(schema: string, table: string, columns: ColumnDraft[]): string {
  const tableName = table.trim() || "<table_name>";
  const colDefs = columns
    .filter((c) => c.name.trim())
    .map((c) => {
      const parts = [`"${c.name.trim()}"`, c.type];
      if (!c.nullable) parts.push("NOT NULL");
      if (c.primaryKey) parts.push("PRIMARY KEY");
      if (c.defaultValue.trim()) parts.push(`DEFAULT ${c.defaultValue.trim()}`);
      return "  " + parts.join(" ");
    });
  if (colDefs.length === 0) return "";
  return `CREATE TABLE "${schema}"."${tableName}" (\n${colDefs.join(",\n")}\n);`;
}

export function CreateTableModal({
  connectionId,
  database,
  schema,
  onClose,
  onCreated,
}: {
  connectionId: string;
  database?: string;
  schema: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [table, setTable] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([
    { name: "id", type: "SERIAL", nullable: false, primaryKey: true, defaultValue: "" },
    emptyColumn(),
  ]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sql = buildCreateTableSql(schema, table, columns);
  const canExecute = table.trim().length > 0 && columns.some((c) => c.name.trim());

  function updateColumn(i: number, patch: Partial<ColumnDraft>) {
    setColumns((cols) => cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addColumn() {
    setColumns((cols) => [...cols, emptyColumn()]);
  }
  function removeColumn(i: number) {
    setColumns((cols) => cols.filter((_, idx) => idx !== i));
  }

  async function handleExecute() {
    if (!sql || !canExecute) return;
    setRunning(true);
    setError(null);
    try {
      const res = await api.executeQuery(connectionId, sql, true, database);
      if (!res.success) {
        setError(res.error ?? "Gagal membuat tabel");
        return;
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal membuat tabel");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-2xl p-6 relative max-h-[88vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-faint hover:text-text transition-colors"
        >
          <X size={18} />
        </button>
        <h2 className="font-display text-lg text-text mb-1">Create Table</h2>
        <p className="text-sm text-text-muted mb-5 font-mono">schema: {schema}</p>

        <div className="overflow-y-auto dbx-scrollbar pr-1 flex-1 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Table Name</label>
            <input
              value={table}
              onChange={(e) => setTable(e.target.value)}
              placeholder="transaksi"
              className="dbx-input"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-text-muted">Columns</label>
              <button
                onClick={addColumn}
                className="flex items-center gap-1 text-xs text-cyan hover:underline"
              >
                <Plus size={12} /> Add Column
              </button>
            </div>
            <div className="space-y-2">
              {columns.map((c, i) => (
                <div key={i} className="dbx-glass rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={c.name}
                      onChange={(e) => updateColumn(i, { name: e.target.value })}
                      placeholder="column_name"
                      className="dbx-input flex-1 min-w-[160px] text-sm font-mono"
                    />
                    <button
                      onClick={() => removeColumn(i)}
                      title="Hapus kolom"
                      className="text-text-faint hover:text-danger shrink-0 p-1"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <select
                      value={c.type}
                      onChange={(e) => updateColumn(i, { type: e.target.value })}
                      className="dbx-input w-40 shrink-0 text-xs"
                    >
                      {COMMON_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0">
                      <input
                        type="checkbox"
                        checked={!c.nullable}
                        onChange={(e) => updateColumn(i, { nullable: !e.target.checked })}
                      />
                      NOT NULL
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0">
                      <input
                        type="checkbox"
                        checked={c.primaryKey}
                        onChange={(e) => updateColumn(i, { primaryKey: e.target.checked })}
                      />
                      PRIMARY KEY
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {sql && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">SQL Preview</label>
              <pre className="dbx-glass rounded-lg p-3 text-xs font-mono text-cyan whitespace-pre-wrap overflow-x-auto">
                {sql}
              </pre>
            </div>
          )}

          {error && (
            <div className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <button
          onClick={handleExecute}
          disabled={running || !canExecute}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 mt-4 hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? "Membuat…" : "Execute"}
        </button>
      </div>
    </div>
  );
}
