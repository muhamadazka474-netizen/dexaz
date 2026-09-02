"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

export interface GridFilter {
  column: string;
  op: string;
  value: string;
}

export function FilterBar({
  columns,
  filters,
  onChange,
}: {
  columns: string[];
  filters: GridFilter[];
  onChange: (filters: GridFilter[]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(filters.map((f) => [f.column, f.value]))
  );

  useEffect(() => {
    const t = setTimeout(() => {
      const next: GridFilter[] = Object.entries(drafts)
        .filter(([, v]) => v.trim() !== "")
        .map(([column, value]) => ({ column, op: "contains", value }));
      onChange(next);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts]);

  const activeCount = Object.values(drafts).filter((v) => v.trim() !== "").length;

  if (columns.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border-glass bg-panel/30 overflow-x-auto dbx-scrollbar">
      <span className="text-[11px] uppercase tracking-wide text-text-faint shrink-0">Filter:</span>
      {columns.map((col) => (
        <div key={col} className="relative shrink-0">
          <input
            value={drafts[col] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [col]: e.target.value }))}
            placeholder={col}
            className="w-32 bg-void-2 border border-border-glass rounded-md pl-2 pr-6 py-1 text-[11px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-cyan/50"
          />
          {drafts[col] && (
            <button
              onClick={() => setDrafts((d) => ({ ...d, [col]: "" }))}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-text-faint hover:text-danger"
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}
      {activeCount > 0 && (
        <button
          onClick={() => setDrafts({})}
          className="shrink-0 text-[11px] text-cyan hover:underline ml-1"
        >
          Clear all ({activeCount})
        </button>
      )}
    </div>
  );
}
