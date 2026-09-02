"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Plus, Play, Pencil, Trash2, ExternalLink, BookOpen, Tag, Eye, FileText,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LibraryQueryModal } from "@/components/LibraryQueryModal";
import { LibraryQueryDetailModal } from "@/components/LibraryQueryDetailModal";
import { ConfirmDestructiveModal } from "@/components/ConfirmDestructiveModal";
import { api, Connection, SavedQueryItem } from "@/lib/api";

export default function LibraryPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [queries, setQueries] = useState<SavedQueryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SavedQueryItem | null>(null);
  const [deleting, setDeleting] = useState<SavedQueryItem | null>(null);
  const [viewing, setViewing] = useState<SavedQueryItem | null>(null);

  function refresh() {
    setLoading(true);
    api.listSavedQueries().then(setQueries).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => {
    api.listConnections().then(setConnections).catch(() => {});
    refresh();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const q of queries) if (q.category) set.add(q.category);
    return [...set].sort();
  }, [queries]);

  const filtered = queries.filter((q) => {
    if (categoryFilter && q.category !== categoryFilter) return false;
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      q.name.toLowerCase().includes(s) ||
      q.sql.toLowerCase().includes(s) ||
      (q.description ?? "").toLowerCase().includes(s) ||
      q.tags.some((t) => t.toLowerCase().includes(s))
    );
  });

  function connectionName(id: string | null) {
    if (!id) return null;
    return connections.find((c) => c.id === id)?.name ?? null;
  }

  function openInEditor(q: SavedQueryItem) {
    sessionStorage.setItem("dbx_pending_sql", q.sql);
    router.push("/sql-editor");
  }

  async function handleDeleteConfirmed() {
    if (!deleting) return;
    await api.deleteSavedQuery(deleting.id);
    setDeleting(null);
    refresh();
  }

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <div className="shrink-0 border-b border-border-glass dbx-glass px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-display text-lg text-text flex items-center gap-2">
                <BookOpen size={17} className="text-cyan" />
                SQL Library
              </h1>
              <p className="text-xs text-text-muted mt-0.5">
                Query SQL yang Anda simpan — dari SQL Editor, Query Builder, atau ditulis langsung di sini.
              </p>
            </div>
            <button
              onClick={() => {
                setEditing(null);
                setShowModal(true);
              }}
              className="flex items-center gap-1.5 text-xs bg-gradient-to-r from-cyan to-blue text-void font-medium rounded-lg px-3 py-2 hover:opacity-90 transition-opacity dbx-glow-cyan"
            >
              <Plus size={13} />
              Query Baru
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, SQL, atau tag…"
                className="dbx-input pl-8 text-sm"
              />
            </div>
            {categories.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setCategoryFilter(null)}
                  className={`text-[11px] rounded-full px-2.5 py-1 border transition-colors ${
                    !categoryFilter
                      ? "border-cyan/40 text-cyan bg-cyan/10"
                      : "border-border-glass text-text-muted hover:text-text"
                  }`}
                >
                  Semua
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategoryFilter(c)}
                    className={`text-[11px] rounded-full px-2.5 py-1 border transition-colors ${
                      categoryFilter === c
                        ? "border-cyan/40 text-cyan bg-cyan/10"
                        : "border-border-glass text-text-muted hover:text-text"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto dbx-scrollbar p-5">
          {loading ? (
            <p className="text-sm text-text-faint">Memuat…</p>
          ) : filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2">
              <BookOpen size={28} className="text-text-faint" />
              <p className="text-sm text-text-faint">
                {queries.length === 0
                  ? "Belum ada query tersimpan. Simpan dari SQL Editor (tombol Save) atau buat baru di sini."
                  : "Tidak ada query yang cocok dengan pencarian/filter."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map((q) => (
                <div
                  key={q.id}
                  className="dbx-glass rounded-xl p-4 flex flex-col cursor-pointer hover:border-cyan/30 border border-transparent transition-colors"
                  onClick={() => setViewing(q)}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-sm text-text font-medium truncate">{q.name}</p>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setViewing(q)}
                        title="Lihat detail"
                        className="text-text-faint hover:text-cyan transition-colors p-1"
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        onClick={() => openInEditor(q)}
                        title="Run di SQL Editor"
                        className="text-text-faint hover:text-cyan transition-colors p-1"
                      >
                        <Play size={13} />
                      </button>
                      <button
                        onClick={() => {
                          setEditing(q);
                          setShowModal(true);
                        }}
                        title="Edit"
                        className="text-text-faint hover:text-text transition-colors p-1"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setDeleting(q)}
                        title="Hapus"
                        className="text-text-faint hover:text-danger transition-colors p-1"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {q.category && <p className="text-[10px] text-violet mb-1.5">{q.category}</p>}

                  {/* Keterangan — deliberately styled to stand out from the raw
                      SQL preview below it (accent border + normal text color,
                      not the faint monospace of the query itself), since this
                      is the part meant to explain the query to someone else. */}
                  {q.description ? (
                    <p className="text-xs text-text-muted mb-2.5 line-clamp-3 border-l-2 border-cyan/40 pl-2 leading-relaxed">
                      {q.description}
                    </p>
                  ) : (
                    <p className="text-xs text-text-faint italic mb-2.5 border-l-2 border-border-glass pl-2 flex items-center gap-1">
                      <FileText size={11} /> Belum ada keterangan
                    </p>
                  )}

                  <pre className="text-[11px] font-mono text-text-faint bg-void-2 rounded-lg p-2.5 mb-2.5 overflow-hidden max-h-24 whitespace-pre-wrap">
                    {q.sql}
                  </pre>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 flex-wrap min-w-0">
                      {q.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="flex items-center gap-0.5 text-[10px] text-text-muted border border-border-glass rounded-full px-1.5 py-0.5"
                        >
                          <Tag size={9} />
                          {t}
                        </span>
                      ))}
                      {connectionName(q.connection_id) && (
                        <span className="text-[10px] text-text-faint">· {connectionName(q.connection_id)}</span>
                      )}
                    </div>
                    <button
                      onClick={() => openInEditor(q)}
                      className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text shrink-0"
                    >
                      <ExternalLink size={11} />
                      Editor
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewing && (
        <LibraryQueryDetailModal
          query={viewing}
          connectionName={connectionName(viewing.connection_id)}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
            setShowModal(true);
          }}
          onRun={() => {
            openInEditor(viewing);
            setViewing(null);
          }}
        />
      )}

      {showModal && (
        <LibraryQueryModal
          existing={editing}
          connections={connections}
          defaultConnectionId={connections[0]?.id ?? null}
          onClose={() => setShowModal(false)}
          onSaved={refresh}
        />
      )}

      {deleting && (
        <ConfirmDestructiveModal
          warning={`Hapus query "${deleting.name}" dari Library? Tindakan ini tidak bisa dibatalkan.`}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleting(null)}
        />
      )}
    </AppShell>
  );
}
