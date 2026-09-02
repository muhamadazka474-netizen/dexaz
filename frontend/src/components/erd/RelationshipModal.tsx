"use client";

import { useState } from "react";
import { X, Play, Loader2, Link2, Unlink } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export type CreateRelationshipPayload = {
  schema: string;
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
};

export type DeleteRelationshipPayload = {
  schema: string;
  table: string;
  constraintName: string;
};

export function RelationshipModal({
  connectionId,
  mode,
  preview,
  description,
  createPayload,
  deletePayload,
  onClose,
  onDone,
}: {
  connectionId: string;
  mode: "create" | "delete";
  preview: string;
  description: string;
  createPayload?: CreateRelationshipPayload;
  deletePayload?: DeleteRelationshipPayload;
  onClose: () => void;
  onDone: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExecute() {
    setRunning(true);
    setError(null);
    try {
      if (mode === "create" && createPayload) {
        await api.createRelationship(
          connectionId,
          createPayload.schema,
          createPayload.table,
          createPayload.column,
          createPayload.refTable,
          createPayload.refColumn
        );
      } else if (mode === "delete" && deletePayload) {
        await api.deleteRelationship(
          connectionId,
          deletePayload.schema,
          deletePayload.table,
          deletePayload.constraintName
        );
      } else {
        return;
      }
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menjalankan perubahan relasi");
    } finally {
      setRunning(false);
    }
  }

  const isDelete = mode === "delete";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-lg p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-text-faint hover:text-text">
          <X size={18} />
        </button>

        <div className="flex items-center gap-2.5 mb-3">
          <div
            className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
              isDelete ? "bg-danger/10 text-danger" : "bg-cyan/10 text-cyan"
            }`}
          >
            {isDelete ? <Unlink size={16} /> : <Link2 size={16} />}
          </div>
          <h2 className="font-display text-base text-text">
            {isDelete ? "Hapus Relationship" : "Buat Foreign Key"}
          </h2>
        </div>

        <p className="text-sm text-text-muted mb-4">{description}</p>

        <pre className="dbx-glass rounded-lg p-3 text-xs font-mono text-cyan whitespace-pre-wrap overflow-x-auto mb-4">
          {preview}
        </pre>

        {error && (
          <div className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2 mb-4 whitespace-pre-wrap max-h-64 overflow-y-auto">
            {error}
          </div>
        )}

        <button
          onClick={handleExecute}
          disabled={running}
          className={`w-full flex items-center justify-center gap-2 rounded-lg font-medium text-sm py-2.5 transition-opacity hover:opacity-90 disabled:opacity-40 ${
            isDelete ? "bg-danger/90 text-void" : "bg-gradient-to-r from-cyan to-blue text-void"
          }`}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? "Menjalankan…" : "Execute"}
        </button>
      </div>
    </div>
  );
}
