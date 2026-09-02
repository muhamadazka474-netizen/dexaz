"use client";

import { useState } from "react";
import { X, Save, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  default_value: string | null;
}

function inputKindFor(type: string): "checkbox" | "date" | "datetime" | "number" | "json" | "text" {
  const t = type.toLowerCase();
  if (t.includes("bool")) return "checkbox";
  if (t.includes("timestamp")) return "datetime";
  if (t === "date") return "date";
  if (t.includes("json")) return "json";
  if (["integer", "bigint", "smallint", "numeric", "real", "double precision", "decimal"].some((n) => t.includes(n)))
    return "number";
  return "text";
}

export function RowFormModal({
  connectionId,
  database,
  schema,
  table,
  columns,
  primaryKeyColumns,
  mode,
  initialValues,
  onClose,
  onSaved,
}: {
  connectionId: string;
  database?: string;
  schema: string;
  table: string;
  columns: ColumnMeta[];
  primaryKeyColumns: string[];
  mode: "add" | "edit";
  initialValues?: Record<string, unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of columns) {
      const v = initialValues?.[c.name];
      init[c.name] = v === null || v === undefined ? "" : String(v);
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(name: string, val: string) {
    setValues((v) => ({ ...v, [name]: val }));
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const c of columns) {
      // Skip auto-generated PKs on insert if left blank (e.g. serial/identity columns)
      if (mode === "add" && primaryKeyColumns.includes(c.name) && values[c.name] === "" && c.default_value) {
        continue;
      }
      const raw = values[c.name];
      const kind = inputKindFor(c.type);
      if (raw === "" ) {
        payload[c.name] = c.nullable ? null : "";
        continue;
      }
      if (kind === "checkbox") payload[c.name] = raw === "true";
      else if (kind === "number") payload[c.name] = Number(raw);
      else if (kind === "json") {
        try {
          payload[c.name] = JSON.parse(raw);
        } catch {
          payload[c.name] = raw;
        }
      } else payload[c.name] = raw;
    }
    return payload;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload();
      if (mode === "add") {
        await api.insertRow(connectionId, schema, table, payload, database);
      } else {
        const pk: Record<string, unknown> = {};
        for (const col of primaryKeyColumns) pk[col] = initialValues?.[col];
        await api.updateRow(connectionId, schema, table, pk, payload, database);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menyimpan baris");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-lg p-6 relative max-h-[85vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-faint hover:text-text transition-colors"
        >
          <X size={18} />
        </button>
        <h2 className="font-display text-lg text-text mb-1">
          {mode === "add" ? "Add Row" : "Edit Row"}
        </h2>
        <p className="text-sm text-text-muted mb-5 font-mono">
          {schema}.{table}
        </p>

        <div className="space-y-3 overflow-y-auto dbx-scrollbar pr-1 flex-1">
          {columns.map((c) => {
            const kind = inputKindFor(c.type);
            const isPk = primaryKeyColumns.includes(c.name);
            const disabled = mode === "edit" && isPk;
            return (
              <div key={c.name}>
                <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1.5">
                  <span className="font-mono">{c.name}</span>
                  <span className="text-text-faint normal-case">{c.type}</span>
                  {isPk && (
                    <span className="text-[9px] uppercase text-cyan border border-cyan/30 rounded px-1 py-0.5">
                      PK
                    </span>
                  )}
                  {!c.nullable && <span className="text-danger">*</span>}
                </label>
                {kind === "checkbox" ? (
                  <select
                    value={values[c.name]}
                    onChange={(e) => setField(c.name, e.target.value)}
                    disabled={disabled}
                    className="dbx-input disabled:opacity-50"
                  >
                    <option value="">—</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : kind === "json" ? (
                  <textarea
                    value={values[c.name]}
                    onChange={(e) => setField(c.name, e.target.value)}
                    disabled={disabled}
                    rows={3}
                    className="dbx-input font-mono text-xs disabled:opacity-50"
                  />
                ) : (
                  <input
                    type={kind === "number" ? "number" : kind === "date" ? "date" : kind === "datetime" ? "datetime-local" : "text"}
                    value={values[c.name]}
                    onChange={(e) => setField(c.name, e.target.value)}
                    disabled={disabled}
                    placeholder={c.default_value ? `default: ${c.default_value}` : undefined}
                    className="dbx-input disabled:opacity-50"
                  />
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2 mt-3">
            {error}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 mt-4 hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? "Menyimpan…" : mode === "add" ? "Insert Row" : "Update Row"}
        </button>
      </div>
    </div>
  );
}
