"use client";

import { useState } from "react";
import { X, Loader2, CheckCircle2, XCircle, FolderOpen } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { FileBrowserModal } from "@/components/FileBrowserModal";

const DB_TYPES = [
  { value: "postgresql", label: "PostgreSQL", defaultPort: 5432 },
  { value: "mysql", label: "MySQL", defaultPort: 3306 },
  { value: "mariadb", label: "MariaDB", defaultPort: 3306 },
  { value: "sqlite", label: "SQLite", defaultPort: null },
] as const;

type DbType = (typeof DB_TYPES)[number]["value"];

export function AddConnectionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    db_type: "postgresql" as DbType,
    host: "127.0.0.1",
    port: 5432,
    database_name: "",
    username: "postgres",
    password: "",
    ssl_mode: "prefer",
    sqlite_path: "",
  });
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFileBrowser, setShowFileBrowser] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setTestResult(null);
  }

  function handleDbTypeChange(dbType: DbType) {
    const meta = DB_TYPES.find((d) => d.value === dbType)!;
    setForm((f) => ({
      ...f,
      db_type: dbType,
      port: meta.defaultPort ?? f.port,
      username: dbType === "postgresql" ? "postgres" : dbType === "sqlite" ? "" : "root",
    }));
    setTestResult(null);
  }

  const isSqlite = form.db_type === "sqlite";

  function isFormValid() {
    if (!form.name) return false;
    if (isSqlite) return !!form.sqlite_path;
    return !!form.database_name;
  }

  function buildPayload() {
    if (isSqlite) {
      return {
        name: form.name,
        db_type: form.db_type,
        sqlite_path: form.sqlite_path,
      };
    }
    return {
      name: form.name,
      db_type: form.db_type,
      host: form.host,
      port: form.port,
      database_name: form.database_name,
      username: form.username,
      password: form.password,
      ssl_mode: form.db_type === "postgresql" ? form.ssl_mode : undefined,
    };
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      // Create a temporary connection to test, then decide whether to keep it.
      const created = await api.createConnection(buildPayload());
      const result = await api.testConnection(created.id);
      setTestResult(result);
      if (!result.success) {
        await api.deleteConnection(created.id);
      } else {
        // keep it — test succeeded, treat this as the save
        onCreated();
        onClose();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menguji koneksi");
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveWithoutTest() {
    setSaving(true);
    setError(null);
    try {
      await api.createConnection(buildPayload());
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menyimpan koneksi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-faint hover:text-text transition-colors"
        >
          <X size={18} />
        </button>

        <h2 className="font-display text-lg text-text mb-1">Add Connection</h2>
        <p className="text-sm text-text-muted mb-5">
          {isSqlite
            ? "Hubungkan ke file database SQLite lokal."
            : "Hubungkan ke database server (lokal atau remote)."}
        </p>

        <div className="space-y-3">
          <Field label="Connection Name">
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Local Pajak"
              className="dbx-input"
            />
          </Field>

          <Field label="Database Type">
            <select
              value={form.db_type}
              onChange={(e) => handleDbTypeChange(e.target.value as DbType)}
              className="dbx-input"
            >
              {DB_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          {isSqlite ? (
            <Field label="File Path">
              <div className="flex gap-2">
                <input
                  value={form.sqlite_path}
                  onChange={(e) => update("sqlite_path", e.target.value)}
                  placeholder="C:\data\aplikasi.db"
                  className="dbx-input flex-1"
                />
                <button
                  type="button"
                  onClick={() => setShowFileBrowser(true)}
                  title="Pilih file dari folder"
                  className="flex items-center gap-1.5 shrink-0 rounded-lg border border-border-glass px-3 text-sm text-text-muted hover:text-text hover:border-cyan/50 transition-colors"
                >
                  <FolderOpen size={15} />
                  Browse
                </button>
              </div>
            </Field>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Host" className="col-span-2">
                  <input
                    value={form.host}
                    onChange={(e) => update("host", e.target.value)}
                    placeholder="127.0.0.1"
                    className="dbx-input"
                  />
                </Field>
                <Field label="Port">
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => update("port", Number(e.target.value))}
                    className="dbx-input"
                  />
                </Field>
              </div>

              <Field label="Database Name">
                <input
                  value={form.database_name}
                  onChange={(e) => update("database_name", e.target.value)}
                  placeholder="pajak"
                  className="dbx-input"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Username">
                  <input
                    value={form.username}
                    onChange={(e) => update("username", e.target.value)}
                    className="dbx-input"
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    className="dbx-input"
                  />
                </Field>
              </div>
            </>
          )}
        </div>

        {testResult && !testResult.success && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger mt-4">
            <XCircle size={14} className="shrink-0 mt-0.5" />
            <span>{testResult.message}</span>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger mt-4">
            <XCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-2 mt-6">
          <button
            onClick={handleTest}
            disabled={testing || saving || !isFormValid()}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {testing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {testing ? "Menguji…" : "Test & Save Connection"}
          </button>
          <button
            onClick={handleSaveWithoutTest}
            disabled={testing || saving || !form.name}
            className="rounded-lg border border-border-glass text-text-muted hover:text-text text-sm py-2.5 px-4 transition-colors disabled:opacity-40"
          >
            {saving ? "…" : "Save only"}
          </button>
        </div>
      </div>

      {showFileBrowser && (
        <FileBrowserModal
          title="Pilih File Database SQLite"
          onClose={() => setShowFileBrowser(false)}
          onSelect={(path) => {
            setForm((f) => {
              const fileName = path.split(/[\\/]/).pop() || "";
              const baseName = fileName.replace(/\.(db|sqlite3?|db3)$/i, "");
              return {
                ...f,
                sqlite_path: path,
                name: f.name || baseName,
              };
            });
            setTestResult(null);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-text-muted mb-1.5">{label}</label>
      {children}
    </div>
  );
}
