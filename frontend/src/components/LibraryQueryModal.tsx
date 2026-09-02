"use client";

import { useState } from "react";
import { X, Save, ChevronDown } from "lucide-react";
import { api, Connection, SavedQueryItem } from "@/lib/api";

export function LibraryQueryModal({
  existing,
  connections,
  defaultConnectionId,
  onClose,
  onSaved,
}: {
  existing?: SavedQueryItem | null;
  connections: Connection[];
  defaultConnectionId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [tags, setTags] = useState(existing?.tags?.join(", ") ?? "");
  const [sql, setSql] = useState(existing?.sql ?? "");
  const [connectionId, setConnectionId] = useState<string | null>(
    existing?.connection_id ?? defaultConnectionId
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeConnection = connections.find((c) => c.id === connectionId);
  const isEdit = !!existing;

  async function handleSave() {
    if (!name.trim() || !sql.trim()) return;
    setSaving(true);
    try {
      const payload = {
        connection_id: connectionId ?? undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        sql,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      };
      if (isEdit && existing) {
        await api.updateSavedQuery(existing.id, payload);
      } else {
        await api.createSavedQuery(payload);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-faint hover:text-text transition-colors"
        >
          <X size={18} />
        </button>
        <h2 className="font-display text-lg text-text mb-1">
          {isEdit ? "Edit Query" : "Query Baru"}
        </h2>
        <p className="text-sm text-text-muted mb-5">
          {isEdit ? "Ubah query tersimpan ini." : "Simpan query SQL baru ke Library."}
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Nama</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Pembayaran Terbesar"
                className="dbx-input"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Kategori</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Tax Analysis"
                className="dbx-input"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              Keterangan{" "}
              <span className="text-text-faint font-normal">
                (jelaskan fungsi/tujuan query ini, agar mudah dipahami orang lain)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contoh: Menampilkan total pembayaran per pelanggan dalam 30 hari terakhir, diurutkan dari yang terbesar. Dipakai untuk laporan bulanan tim finance."
              rows={3}
              className="dbx-input resize-y"
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

          {connections.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Koneksi (opsional)</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((o) => !o)}
                  className="dbx-input text-sm flex items-center justify-between"
                >
                  <span>{activeConnection?.name ?? "Semua koneksi"}</span>
                  <ChevronDown size={13} className="text-text-faint shrink-0" />
                </button>
                {pickerOpen && (
                  <div className="absolute top-full mt-1 left-0 right-0 dbx-glass-strong rounded-lg py-1 z-20 max-h-40 overflow-y-auto dbx-scrollbar">
                    <button
                      onClick={() => {
                        setConnectionId(null);
                        setPickerOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-panel/60 transition-colors ${
                        !connectionId ? "text-cyan" : "text-text"
                      }`}
                    >
                      Semua koneksi
                    </button>
                    {connections.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setConnectionId(c.id);
                          setPickerOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-panel/60 transition-colors ${
                          c.id === connectionId ? "text-cyan" : "text-text"
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">SQL</label>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder="SELECT * FROM ..."
              rows={6}
              className="dbx-input font-mono text-xs resize-y"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !sql.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 mt-6 hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          <Save size={14} />
          {saving ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Simpan"}
        </button>
      </div>
    </div>
  );
}
