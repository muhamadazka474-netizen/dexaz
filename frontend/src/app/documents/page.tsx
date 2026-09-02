"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Upload, FileText, Presentation, Trash2, Loader2, Eye } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui";
import { ConfirmDestructiveModal } from "@/components/ConfirmDestructiveModal";
import { api, ApiError, AppDocument } from "@/lib/api";

// react-pdf (pdf.js) touches browser-only globals (DOMMatrix, etc.) at
// module-evaluation time, which breaks Next.js's server-side prerender of
// this page. Loading the viewer only on the client sidesteps that — it's
// only ever opened after a user click anyway, so there's no content it
// would be useful to prerender.
const DocumentViewerModal = dynamic(
  () => import("@/components/DocumentViewerModal").then((m) => m.DocumentViewerModal),
  { ssr: false }
);

const ACCEPTED_EXTENSIONS = [".pdf", ".ppt", ".pptx"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<AppDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [viewing, setViewing] = useState<AppDocument | null>(null);
  const [deleting, setDeleting] = useState<AppDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function refresh() {
    setLoading(true);
    api
      .listDocuments()
      .then(setDocs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploadError(null);
    const list = Array.from(files);
    for (const f of list) {
      const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        setUploadError(`Format tidak didukung: ${f.name}. Hanya .pdf, .ppt, .pptx.`);
        continue;
      }
      setUploading(true);
      try {
        await api.uploadDocument(f);
      } catch (e) {
        setUploadError(e instanceof ApiError ? e.message : `Gagal mengunggah ${f.name}`);
      } finally {
        setUploading(false);
      }
    }
    refresh();
  }, []);

  async function handleDeleteConfirmed() {
    if (!deleting) return;
    await api.deleteDocument(deleting.id);
    setDeleting(null);
    refresh();
  }

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader
          title="Dokumen"
          subtitle="Unggah, lihat, zoom, dan presentasikan file PDF atau PowerPoint — semuanya tersimpan lokal di PC ini."
          action={
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-cyan to-blue text-void font-medium text-sm px-4 py-2 dbx-glow-cyan disabled:opacity-60 transition-opacity"
            >
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              Unggah Dokumen
            </button>
          }
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
          }}
          className={`dbx-glass rounded-xl p-8 flex flex-col items-center justify-center gap-2 cursor-pointer border-2 border-dashed transition-colors mb-6 ${
            dragOver ? "border-cyan/50 bg-cyan/5" : "border-border-glass-strong hover:border-cyan/30"
          }`}
        >
          <Upload size={24} className="text-text-faint" />
          <p className="text-sm text-text-muted">
            Tarik &amp; lepas file di sini, atau klik untuk memilih (.pdf, .ppt, .pptx)
          </p>
        </div>

        {uploadError && (
          <p className="text-sm text-danger mb-4 dbx-glass rounded-lg px-4 py-2.5 border-danger/30">
            {uploadError}
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-muted py-16 justify-center">
            <Loader2 size={18} className="animate-spin" />
            Memuat dokumen...
          </div>
        ) : docs.length === 0 ? (
          <div className="dbx-glass rounded-xl p-12 text-center text-sm text-text-muted">
            Belum ada dokumen. Unggah file PDF atau PowerPoint untuk mulai melihatnya di sini.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {docs.map((d) => {
              const isPdf = d.file_type === "pdf";
              const Icon = isPdf ? FileText : Presentation;
              return (
                <div
                  key={d.id}
                  onClick={() => setViewing(d)}
                  className="dbx-glass rounded-xl p-4 flex flex-col cursor-pointer hover:border-cyan/30 border border-transparent transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div
                      className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isPdf ? "text-danger bg-danger/10" : "text-cyan bg-cyan/10"
                      }`}
                    >
                      <Icon size={17} />
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setViewing(d)}
                        title="Lihat"
                        className="text-text-faint hover:text-cyan transition-colors p-1"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={() => setDeleting(d)}
                        title="Hapus"
                        className="text-text-faint hover:text-danger transition-colors p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-text font-medium truncate mb-1" title={d.filename}>
                    {d.filename}
                  </p>
                  <p className="text-xs text-text-faint">
                    {formatSize(d.size_bytes)} &middot; {formatDate(d.uploaded_at)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {viewing && <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />}

      {deleting && (
        <ConfirmDestructiveModal
          warning={`Hapus dokumen "${deleting.filename}"? File ini akan dihapus permanen dari PC.`}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleting(null)}
        />
      )}
    </AppShell>
  );
}
