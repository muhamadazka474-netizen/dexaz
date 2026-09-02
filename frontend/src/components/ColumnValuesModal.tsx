"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Search, ListTree } from "lucide-react";
import { api, ApiError, ColumnValuesResult } from "@/lib/api";

interface ColumnValuesSource {
  connectionId: string;
  schema?: string;
  table?: string;
  savedQueryId?: string;
}

export function ColumnValuesModal({
  source,
  column,
  onClose,
}: {
  source: ColumnValuesSource;
  column: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ColumnValuesResult | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .dashboardColumnValues({ ...source, column, limit: 1000 })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Gagal memuat daftar nilai");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.values;
    const q = search.trim().toLowerCase();
    return data.values.filter((v) => v.value.toLowerCase().includes(q));
  }, [data, search]);

  const maxCount = data?.values[0]?.count ?? 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-faint hover:text-text transition-colors"
        >
          <X size={18} />
        </button>

        <div className="pr-8 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <ListTree size={15} className="text-cyan shrink-0" />
            <h2 className="font-display text-lg text-text font-mono truncate">{column}</h2>
          </div>
          <p className="text-xs text-text-faint">
            Semua nilai berbeda pada kolom ini, dihitung dari seluruh sumber (bukan sampel).
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-text-muted py-10 justify-center">
            <Loader2 size={14} className="animate-spin" /> Memuat daftar nilai...
          </div>
        )}

        {error && (
          <div className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2 mt-4">
            {error}
          </div>
        )}

        {data && !loading && !error && (
          <>
            <div className="mt-4 mb-3 shrink-0 flex items-center gap-3">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nilai..."
                  className="dbx-input text-xs pl-7"
                />
              </div>
              <span className="text-[11px] text-text-faint whitespace-nowrap">
                {data.total_distinct !== null
                  ? `${data.total_distinct.toLocaleString("id-ID")} nilai berbeda`
                  : `${data.values.length.toLocaleString("id-ID")} nilai`}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto dbx-scrollbar min-h-0 space-y-1 pr-1">
              {filtered.length === 0 ? (
                <p className="text-xs text-text-faint text-center py-8">
                  Tidak ada nilai yang cocok dengan pencarian.
                </p>
              ) : (
                filtered.map((v) => (
                  <div key={v.value} className="flex items-center gap-2.5">
                    <div className="flex-1 min-w-0 relative rounded-md overflow-hidden bg-void-2">
                      <div
                        className="absolute inset-y-0 left-0 bg-cyan/15"
                        style={{ width: `${Math.max((v.count / maxCount) * 100, 2)}%` }}
                      />
                      <p className="relative text-xs text-text px-2.5 py-1.5 truncate">{v.value}</p>
                    </div>
                    <span className="text-[11px] font-mono text-text-muted tabular-nums shrink-0 w-14 text-right">
                      {v.count.toLocaleString("id-ID")}
                    </span>
                  </div>
                ))
              )}
            </div>

            {data.truncated && (
              <p className="text-[11px] text-text-faint mt-3 pt-3 border-t border-border-glass shrink-0">
                Menampilkan {data.values.length.toLocaleString("id-ID")} nilai teratas dari{" "}
                {data.total_distinct?.toLocaleString("id-ID")} nilai berbeda — terlalu banyak untuk
                ditampilkan sekaligus.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
