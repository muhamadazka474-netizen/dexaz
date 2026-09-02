"use client";

import { useEffect, useState } from "react";
import { Folder, FileText, Database, ChevronLeft, X, Loader2, HardDrive, XCircle } from "lucide-react";
import { api, ApiError, FsEntry } from "@/lib/api";

/**
 * Dialog "Browse..." untuk memilih file lokal (dipakai buat file SQLite)
 * lewat backend, bukan lewat <input type="file"> browser biasa — karena
 * <input type="file"> di browser tidak pernah memberi full path (dibatasi
 * demi keamanan), padahal DEXAZ butuh full path untuk membuka file .db
 * dari disk. Backend dan browser sama-sama jalan di PC yang sama, jadi ini
 * aman: user cuma menjelajah foldernya sendiri.
 */
export function FileBrowserModal({
  onClose,
  onSelect,
  title = "Pilih File",
}: {
  onClose: () => void;
  onSelect: (path: string) => void;
  title?: string;
}) {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [roots, setRoots] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function load(path?: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await api.fsBrowse(path);
      setCurrentPath(result.current_path);
      setParentPath(result.parent_path);
      setEntries(result.entries);
      setSelected(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal membuka folder");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await api.fsRoots();
        setRoots(r.roots);
      } catch {
        /* roots gagal dimuat bukan fatal — daftar folder tetap bisa dipakai */
      }
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  function handleEntryClick(entry: FsEntry) {
    if (entry.is_dir) {
      load(entry.path);
    } else {
      setSelected(entry.path);
    }
  }

  function handleConfirm() {
    if (selected) {
      onSelect(selected);
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-lg p-6 relative flex flex-col" style={{ maxHeight: "80vh" }}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-faint hover:text-text transition-colors"
        >
          <X size={18} />
        </button>

        <h2 className="font-display text-lg text-text mb-1">{title}</h2>
        <p className="text-sm text-text-muted mb-4 truncate" title={currentPath ?? undefined}>
          {currentPath ?? "Memuat…"}
        </p>

        {roots.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {roots.map((r) => (
              <button
                key={r.path}
                onClick={() => load(r.path)}
                className="flex items-center gap-1 rounded-md border border-border-glass px-2 py-1 text-xs text-text-muted hover:text-text hover:border-cyan/50 transition-colors"
              >
                <HardDrive size={12} />
                {r.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto rounded-lg border border-border-glass min-h-[240px]">
          {loading ? (
            <div className="flex items-center justify-center h-full py-16 text-text-faint">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 px-3 py-3 text-xs text-danger">
              <XCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="divide-y divide-border-glass">
              {parentPath && (
                <button
                  onClick={() => load(parentPath)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:bg-white/5 transition-colors text-left"
                >
                  <ChevronLeft size={15} />
                  ..
                </button>
              )}
              {entries.length === 0 && !parentPath ? (
                <div className="px-3 py-6 text-center text-xs text-text-faint">Folder ini kosong</div>
              ) : entries.length === 0 ? null : (
                entries.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => handleEntryClick(entry)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      selected === entry.path
                        ? "bg-cyan/15 text-text"
                        : entry.is_dir
                        ? "text-text hover:bg-white/5"
                        : entry.is_sqlite_file
                        ? "text-text hover:bg-white/5"
                        : "text-text-faint hover:bg-white/5"
                    }`}
                  >
                    {entry.is_dir ? (
                      <Folder size={15} className="shrink-0 text-cyan" />
                    ) : entry.is_sqlite_file ? (
                      <Database size={15} className="shrink-0 text-cyan" />
                    ) : (
                      <FileText size={15} className="shrink-0" />
                    )}
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={handleConfirm}
            disabled={!selected}
            className="flex-1 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Pilih File{selected ? `: ${selected.split(/[\\/]/).pop()}` : ""}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-border-glass text-text-muted hover:text-text text-sm py-2.5 px-4 transition-colors"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}
