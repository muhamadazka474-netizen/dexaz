"use client";

import { useState } from "react";
import { X, Play, Pencil, Copy, Check, Tag, Plug, ClipboardList } from "lucide-react";
import { SavedQueryItem } from "@/lib/api";

// A clean, read-only, full-size view of a single saved query — meant for
// the moment you need to explain a query to a teammate (screen-share,
// stand-up, handover) rather than the small truncated card in the grid.
// Everything that matters (what it's for, the full SQL, tags, connection)
// is laid out at readable size with nothing clipped.
export function LibraryQueryDetailModal({
  query,
  connectionName,
  onClose,
  onEdit,
  onRun,
}: {
  query: SavedQueryItem;
  connectionName: string | null;
  onClose: () => void;
  onEdit: () => void;
  onRun: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(query.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — silently ignore, the SQL is still visible to select manually
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-faint hover:text-text transition-colors"
        >
          <X size={18} />
        </button>

        <div className="pr-8 shrink-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="font-display text-xl text-text">{query.name}</h2>
            {query.category && (
              <span className="text-[11px] text-violet border border-violet/30 bg-violet/10 rounded-full px-2 py-0.5">
                {query.category}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-text-faint">
            {connectionName && (
              <span className="flex items-center gap-1">
                <Plug size={11} /> {connectionName}
              </span>
            )}
            <span>
              Disimpan {new Date(query.created_at).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto dbx-scrollbar mt-4 space-y-4 min-h-0">
          <div>
            <p className="text-[11px] uppercase tracking-[0.1em] text-text-faint mb-1.5 flex items-center gap-1.5">
              <ClipboardList size={11} /> Keterangan
            </p>
            {query.description ? (
              <p className="text-sm text-text leading-relaxed border-l-2 border-cyan/40 pl-3">
                {query.description}
              </p>
            ) : (
              <p className="text-sm text-text-faint italic border-l-2 border-border-glass pl-3">
                Belum ada keterangan untuk query ini.{" "}
                <button onClick={onEdit} className="text-cyan hover:underline not-italic">
                  Tambahkan sekarang
                </button>
                {" "}supaya lebih mudah dipahami orang lain.
              </p>
            )}
          </div>

          {query.tags.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] text-text-faint mb-1.5">Tags</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {query.tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 text-xs text-text-muted border border-border-glass rounded-full px-2 py-0.5"
                  >
                    <Tag size={10} />
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] uppercase tracking-[0.1em] text-text-faint">SQL</p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text transition-colors"
              >
                {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
                {copied ? "Disalin" : "Salin"}
              </button>
            </div>
            <pre className="text-[12px] font-mono text-text bg-void-2 rounded-lg p-3.5 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {query.sql}
            </pre>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border-glass shrink-0">
          <button
            onClick={onRun}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 hover:opacity-90 transition-opacity"
          >
            <Play size={14} />
            Jalankan di SQL Editor
          </button>
          <button
            onClick={onEdit}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border-glass text-text-muted hover:text-text hover:border-border-glass-strong text-sm px-4 py-2.5 transition-colors"
          >
            <Pencil size={14} />
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}
