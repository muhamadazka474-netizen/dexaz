"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileJson, FileText, Loader2 } from "lucide-react";

export function ExportMenu({
  onExportCurrent,
  onExportAll,
  busy,
}: {
  onExportCurrent: (format: "csv" | "json" | "excel") => void;
  onExportAll?: (format: "csv" | "json" | "excel") => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const items: { format: "csv" | "json" | "excel"; label: string; icon: React.ReactNode }[] = [
    { format: "csv", label: "CSV", icon: <FileText size={13} /> },
    { format: "json", label: "JSON", icon: <FileJson size={13} /> },
    { format: "excel", label: "Excel", icon: <FileSpreadsheet size={13} /> },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text border border-border-glass rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        Export
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 dbx-glass-strong rounded-lg py-1.5 min-w-[210px] z-30"
          onMouseLeave={() => setOpen(false)}
        >
          <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-text-faint">Tampilan saat ini</p>
          {items.map((it) => (
            <button
              key={`current-${it.format}`}
              onClick={() => {
                onExportCurrent(it.format);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-panel/60 transition-colors"
            >
              {it.icon}
              {it.label}
            </button>
          ))}
          {onExportAll && (
            <>
              <div className="my-1 border-t border-border-glass" />
              <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-text-faint">Seluruh tabel</p>
              {items.map((it) => (
                <button
                  key={`all-${it.format}`}
                  onClick={() => {
                    onExportAll(it.format);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-panel/60 transition-colors"
                >
                  {it.icon}
                  {it.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
