"use client";

import { useState } from "react";
import { X, Save } from "lucide-react";
import { api } from "@/lib/api";

export function SaveQueryModal({
  sql,
  connectionId,
  onClose,
  onSaved,
}: {
  sql: string;
  connectionId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createSavedQuery({
        connection_id: connectionId ?? undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        sql,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onSaved();
      onClose();
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
        <h2 className="font-display text-lg text-text mb-1">Save Query</h2>
        <p className="text-sm text-text-muted mb-5">Simpan query ini ke SQL Library pribadi Anda.</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="WP Pembayaran Terbesar"
              className="dbx-input"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Tax Analysis"
              className="dbx-input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="dbx-input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Tags (pisahkan koma)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="pajak, payment, analysis"
              className="dbx-input"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 mt-6 hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          <Save size={14} />
          {saving ? "Menyimpan…" : "Save"}
        </button>
      </div>
    </div>
  );
}
