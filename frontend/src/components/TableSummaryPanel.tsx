"use client";

import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Loader2,
  Table2,
  FileCode2,
  ChevronDown,
  ChevronUp,
  Trash2,
  SlidersHorizontal,
  Check,
  Rows3,
} from "lucide-react";
import { GlassCard } from "@/components/ui";
import { ReportPanel, ReportItem, ItemResult, REPORT_STORAGE_KEY } from "@/components/ReportPanel";
import { ColumnValuesModal } from "@/components/ColumnValuesModal";
import {
  api,
  ApiError,
  Connection,
  SchemaTree,
  SavedQueryItem,
  TableSummaryResult,
} from "@/lib/api";

const STATE_STORAGE_KEY = "dbx:dashboard-summary-state";
const COLLAPSED_STORAGE_KEY = "dbx:dashboard-summary-collapsed";

interface VisibleStats {
  nullInfo: boolean;
  distinct: boolean;
  minMax: boolean;
  avg: boolean;
  topValues: boolean;
}

const DEFAULT_VISIBLE_STATS: VisibleStats = {
  nullInfo: true,
  distinct: true,
  minMax: true,
  avg: true,
  topValues: true,
};

const STAT_TOGGLES: { key: keyof VisibleStats; label: string }[] = [
  { key: "nullInfo", label: "Null count & persentase" },
  { key: "distinct", label: "Distinct count" },
  { key: "minMax", label: "Min / Max (angka & tanggal)" },
  { key: "avg", label: "Rata-rata (khusus kolom angka)" },
  { key: "topValues", label: "Nilai teratas (khusus kolom teks)" },
];

const SUMMARY_GRID_CLASS: Record<2 | 3 | 4, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

interface PersistedSummaryState {
  connectionId: string;
  source: "table" | "saved_query";
  schema: string;
  table: string;
  savedQueryId: string;
  result: TableSummaryResult | null;
  // Columns the user chose to hide from the "Ringkasan Tabel" card grid —
  // customization is opt-out (everything shown by default) rather than
  // opt-in, so a table with new columns doesn't silently hide them.
  hiddenColumns: string[];
  // Which stat lines show inside each column card, how many "top values"
  // to list, and how many cards per row — the actual content/layout
  // customization this panel is about, on top of just picking columns.
  visibleStats: VisibleStats;
  // "all" means: don't try to list values inline — go straight to the
  // "Lihat semua (value)" modal button instead.
  topValuesCount: number | "all";
  summaryGridCols: 2 | 3 | 4;
}

export function TableSummaryPanel() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [tree, setTree] = useState<SchemaTree | null>(null);
  const [savedQueries, setSavedQueries] = useState<SavedQueryItem[]>([]);
  const [source, setSource] = useState<"table" | "saved_query">("table");
  const [schema, setSchema] = useState("");
  const [table, setTable] = useState("");
  const [savedQueryId, setSavedQueryId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TableSummaryResult | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [reportResetToken, setReportResetToken] = useState(0);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [visibleStats, setVisibleStats] = useState<VisibleStats>(DEFAULT_VISIBLE_STATS);
  const [topValuesCount, setTopValuesCount] = useState<number | "all">(3);
  const [summaryGridCols, setSummaryGridCols] = useState<2 | 3 | 4>(3);
  const [statPickerOpen, setStatPickerOpen] = useState(false);
  // Column whose full distinct-value breakdown is currently open in the
  // "Lihat semua" modal — null when the modal is closed.
  const [viewingColumn, setViewingColumn] = useState<string | null>(null);
  // Laporan data restored from localStorage, read in the SAME synchronous
  // pass as the selection below (not in ReportPanel's own effect). Passing
  // it down as a prop — seeded once via useState's lazy initializer inside
  // ReportPanel — means the report never has to "catch up" to the parent's
  // restored connectionId/schema/table across renders; it's correct from
  // ReportPanel's very first mount.
  const [initialReport, setInitialReport] = useState<{
    items: ReportItem[];
    results: Record<string, ItemResult>;
  } | null>(null);
  // Which source `initialReport` was restored for. If the user switches
  // table/connection during the session, the current selection no longer
  // matches this and `initialReport` must not be handed to the (new)
  // ReportPanel instance for the newly-picked table — otherwise a table
  // switch would incorrectly resurrect the *previous* table's report.
  const initialReportSourceKey = useRef<string | null>(null);

  // Restore the previously built summary/selection (and the collapsed
  // state) so a page refresh doesn't throw away what the user already put
  // together. This must run before — and must not be clobbered by — the
  // connection-driven effects below.
  useEffect(() => {
    let restoredConnectionId = "";
    let restoredSource: "table" | "saved_query" = "table";
    let restoredSchema = "";
    let restoredTable = "";
    let restoredSavedQueryId = "";
    try {
      const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
      if (raw) {
        const saved: PersistedSummaryState = JSON.parse(raw);
        restoredConnectionId = saved.connectionId ?? "";
        restoredSource = saved.source ?? "table";
        restoredSchema = saved.schema ?? "";
        restoredTable = saved.table ?? "";
        restoredSavedQueryId = saved.savedQueryId ?? "";
        setConnectionId(restoredConnectionId);
        setSource(restoredSource);
        setSchema(restoredSchema);
        setTable(restoredTable);
        setSavedQueryId(restoredSavedQueryId);
        setResult(saved.result ?? null);
        setHiddenColumns(saved.hiddenColumns ?? []);
        setVisibleStats({ ...DEFAULT_VISIBLE_STATS, ...(saved.visibleStats ?? {}) });
        setTopValuesCount(saved.topValuesCount ?? 3);
        if ([2, 3, 4].includes(saved.summaryGridCols)) setSummaryGridCols(saved.summaryGridCols);
      }
      setCollapsed(window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1");

      // Same pass: check whether a saved Laporan matches this exact
      // (just-restored) source, and hand it to ReportPanel as its initial
      // state rather than letting it re-derive this asynchronously.
      const rawReport = window.localStorage.getItem(REPORT_STORAGE_KEY);
      if (rawReport) {
        const savedReport: { sourceKey: string; items: ReportItem[]; results: Record<string, ItemResult> } =
          JSON.parse(rawReport);
        const expectedSourceKey = JSON.stringify(
          restoredSource === "table"
            ? { connectionId: restoredConnectionId, schema: restoredSchema, table: restoredTable }
            : { connectionId: restoredConnectionId, savedQueryId: restoredSavedQueryId }
        );
        if (savedReport.sourceKey === expectedSourceKey) {
          setInitialReport({ items: savedReport.items ?? [], results: savedReport.results ?? {} });
          initialReportSourceKey.current = expectedSourceKey;
        }
      }
    } catch {
      // localStorage unavailable/corrupt — just start fresh.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    api
      .listConnections()
      .then((cs) => {
        setConnections(cs);
        setConnectionId((prev) => (prev && cs.some((c) => c.id === prev) ? prev : cs[0]?.id ?? ""));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!connectionId) return;
    api
      .getSchemas(connectionId)
      .then((t) => {
        setTree(t);
        setSchema((prev) => (prev && t.schemas.some((s) => s.schema === prev) ? prev : t.schemas[0]?.schema ?? ""));
      })
      .catch(() => setTree(null));
    api.listSavedQueries(connectionId).then(setSavedQueries).catch(() => setSavedQueries([]));
  }, [connectionId]);

  // Persist selection + result on every change, once initial hydration has
  // happened (otherwise the pre-hydration empty defaults would briefly
  // overwrite whatever was already saved).
  useEffect(() => {
    if (!hydrated) return;
    try {
      const toSave: PersistedSummaryState = {
        connectionId,
        source,
        schema,
        table,
        savedQueryId,
        result,
        hiddenColumns,
        visibleStats,
        topValuesCount,
        summaryGridCols,
      };
      window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // ignore (storage full/unavailable)
    }
  }, [
    hydrated,
    connectionId,
    source,
    schema,
    table,
    savedQueryId,
    result,
    hiddenColumns,
    visibleStats,
    topValuesCount,
    summaryGridCols,
  ]);

  function handleConnectionChange(id: string) {
    setConnectionId(id);
    setTable("");
    setSavedQueryId("");
    setResult(null);
  }

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  function clearAll() {
    setResult(null);
    setError(null);
    setInitialReport(null);
    setHiddenColumns([]);
    initialReportSourceKey.current = null;
    try {
      window.localStorage.removeItem(STATE_STORAGE_KEY);
      window.localStorage.removeItem(REPORT_STORAGE_KEY);
    } catch {
      // ignore
    }
    // Force ReportPanel to remount with a clean slate instead of restoring
    // whatever it had cached.
    setReportResetToken((t) => t + 1);
  }

  const tablesInSchema = tree?.schemas.find((s) => s.schema === schema)?.tables ?? [];

  function toggleColumnVisibility(col: string) {
    setHiddenColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  }

  function toggleStat(key: keyof VisibleStats) {
    setVisibleStats((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSummarize() {
    if (!connectionId) return;
    if (source === "table" && (!schema || !table)) return;
    if (source === "saved_query" && !savedQueryId) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setHiddenColumns([]);
    try {
      const res = await api.dashboardTableSummary(
        source === "table"
          ? { connectionId, schema, table }
          : { connectionId, savedQueryId }
      );
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal membuat ringkasan");
    } finally {
      setLoading(false);
    }
  }

  const canSummarize =
    !!connectionId && (source === "table" ? !!schema && !!table : !!savedQueryId);

  const currentSourceKey = JSON.stringify(
    source === "table" ? { connectionId, schema, table } : { connectionId, savedQueryId }
  );
  const reportMatchesInitial = initialReportSourceKey.current === currentSourceKey;

  return (
    <>
      <GlassCard className="p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-cyan" />
          <h2 className="font-display text-base text-text">Ringkasan Tabel</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {result && (
            <div className="relative">
              <button
                onClick={() => setColPickerOpen((o) => !o)}
                title="Pilih kolom yang ditampilkan"
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-cyan rounded-lg px-2.5 py-1.5 border border-border-glass hover:border-cyan/40 transition-colors"
              >
                <SlidersHorizontal size={12} />
                Kolom
                <span className="text-text-faint">
                  ({result.column_profiles.length - hiddenColumns.length}/{result.column_profiles.length})
                </span>
              </button>
              {colPickerOpen && (
                <>
                  {/* Click-outside catcher */}
                  <div className="fixed inset-0 z-10" onClick={() => setColPickerOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 dbx-glass-strong rounded-lg py-1.5 w-56 max-h-72 overflow-y-auto dbx-scrollbar">
                    <div className="flex items-center justify-between px-3 py-1">
                      <button
                        onClick={() => setHiddenColumns([])}
                        className="text-[11px] text-cyan hover:underline"
                      >
                        Tampilkan semua
                      </button>
                      <button
                        onClick={() => setHiddenColumns(result.column_profiles.map((p) => p.column))}
                        className="text-[11px] text-text-faint hover:underline"
                      >
                        Sembunyikan semua
                      </button>
                    </div>
                    <div className="border-t border-border-glass my-1" />
                    {result.column_profiles.map((p) => {
                      const visible = !hiddenColumns.includes(p.column);
                      return (
                        <button
                          key={p.column}
                          onClick={() => toggleColumnVisibility(p.column)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-panel/60 transition-colors text-left"
                        >
                          <span
                            className={`flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0 ${
                              visible ? "bg-cyan/20 border-cyan/50" : "border-border-glass"
                            }`}
                          >
                            {visible && <Check size={10} className="text-cyan" />}
                          </span>
                          <span className={`font-mono truncate ${visible ? "text-text" : "text-text-faint"}`}>
                            {p.column}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          {result && (
            <div className="relative">
              <button
                onClick={() => setStatPickerOpen((o) => !o)}
                title="Atur isi tiap kartu & tata letak"
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-cyan rounded-lg px-2.5 py-1.5 border border-border-glass hover:border-cyan/40 transition-colors"
              >
                <Rows3 size={12} />
                Tampilan
              </button>
              {statPickerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setStatPickerOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 dbx-glass-strong rounded-lg py-2.5 px-1 w-64 max-h-[70vh] overflow-y-auto overscroll-contain dbx-scrollbar">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-text-faint px-2 mb-1.5">
                      Isi tiap kartu
                    </p>
                    {STAT_TOGGLES.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => toggleStat(key)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-panel/60 rounded-md transition-colors text-left"
                      >
                        <span
                          className={`flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0 ${
                            visibleStats[key] ? "bg-cyan/20 border-cyan/50" : "border-border-glass"
                          }`}
                        >
                          {visibleStats[key] && <Check size={10} className="text-cyan" />}
                        </span>
                        <span className={visibleStats[key] ? "text-text" : "text-text-faint"}>{label}</span>
                      </button>
                    ))}

                    {visibleStats.topValues && (
                      <div className="px-2 pt-2 mt-1 border-t border-border-glass">
                        <label className="block text-[11px] text-text-muted mb-1">
                          Jumlah nilai teratas ditampilkan
                        </label>
                        <div className="flex items-center gap-1 flex-wrap">
                          {([3, 5, 10, "all"] as const).map((n) => (
                            <button
                              key={n}
                              onClick={() => setTopValuesCount(n)}
                              className={`text-[11px] rounded-md px-2 py-1 border transition-colors ${
                                topValuesCount === n
                                  ? "border-cyan/40 bg-cyan/15 text-cyan"
                                  : "border-border-glass text-text-muted hover:text-text"
                              }`}
                            >
                              {n === "all" ? "Semua" : n}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="px-2 pt-2 mt-1 border-t border-border-glass">
                      <label className="block text-[11px] text-text-muted mb-1">Kartu per baris</label>
                      <div className="flex items-center gap-1">
                        {([2, 3, 4] as const).map((n) => (
                          <button
                            key={n}
                            onClick={() => setSummaryGridCols(n)}
                            className={`text-[11px] rounded-md px-2 py-1 border transition-colors ${
                              summaryGridCols === n
                                ? "border-cyan/40 bg-cyan/15 text-cyan"
                                : "border-border-glass text-text-muted hover:text-text"
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {result && (
            <button
              onClick={clearAll}
              title="Hapus ringkasan dan laporan yang sudah disusun"
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-danger rounded-lg px-2.5 py-1.5 border border-border-glass hover:border-danger/40 transition-colors"
            >
              <Trash2 size={12} /> Clear All
            </button>
          )}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Tampilkan panel" : "Sembunyikan panel"}
            className="flex items-center justify-center h-7 w-7 rounded-lg text-text-muted hover:text-text hover:bg-panel/60 border border-border-glass transition-colors"
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {collapsed ? (
        <p className="text-xs text-text-faint">
          Panel disembunyikan.{" "}
          <button onClick={toggleCollapsed} className="text-cyan hover:underline">
            Tampilkan kembali
          </button>
          {result && ` — ringkasan "${result.source}" masih tersimpan.`}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2.5 mb-4">
            <div>
              <label className="block text-[11px] text-text-muted mb-1">Connection</label>
              <select
                value={connectionId}
                onChange={(e) => handleConnectionChange(e.target.value)}
                className="dbx-input w-44 text-xs"
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1 dbx-glass rounded-lg p-1">
              <button
                onClick={() => setSource("table")}
                className={`flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 transition-colors ${
                  source === "table" ? "bg-cyan/15 text-cyan" : "text-text-muted hover:text-text"
                }`}
              >
                <Table2 size={12} /> Tabel
              </button>
              <button
                onClick={() => setSource("saved_query")}
                className={`flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 transition-colors ${
                  source === "saved_query" ? "bg-cyan/15 text-cyan" : "text-text-muted hover:text-text"
                }`}
              >
                <FileCode2 size={12} /> Saved Query
              </button>
            </div>

            {source === "table" ? (
              <>
                <div>
                  <label className="block text-[11px] text-text-muted mb-1">Schema</label>
                  <select
                    value={schema}
                    onChange={(e) => {
                      setSchema(e.target.value);
                      setTable("");
                    }}
                    className="dbx-input w-32 text-xs"
                  >
                    {(tree?.schemas ?? []).map((s) => (
                      <option key={s.schema} value={s.schema}>
                        {s.schema}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-text-muted mb-1">Tabel</label>
                  <select
                    value={table}
                    onChange={(e) => setTable(e.target.value)}
                    className="dbx-input w-44 text-xs"
                  >
                    <option value="">-- pilih tabel --</option>
                    {tablesInSchema.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Query tersimpan</label>
                <select
                  value={savedQueryId}
                  onChange={(e) => setSavedQueryId(e.target.value)}
                  className="dbx-input w-64 text-xs"
                >
                  <option value="">-- pilih query --</option>
                  {savedQueries.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={handleSummarize}
              disabled={!canSummarize || loading}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-xs px-3.5 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <BarChart3 size={13} />}
              Buat Ringkasan
            </button>
          </div>

          {source === "saved_query" && savedQueries.length === 0 && (
            <p className="text-xs text-text-faint mb-2">
              Belum ada query tersimpan untuk koneksi ini. Simpan query dari Query Builder atau SQL
              Editor ke Library terlebih dahulu.
            </p>
          )}

          {error && (
            <div className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2 mb-2">
              {error}
            </div>
          )}

          {result && (
            <div>
              <div className="flex items-center gap-4 mb-3 text-xs text-text-muted">
                <span>
                  Sumber: <span className="text-text font-mono">{result.source}</span>
                </span>
                <span>
                  {result.total_rows.toLocaleString("id-ID")} baris
                  {result.is_sampled && (
                    <span className="text-text-faint">
                      {" "}
                      (statistik dari sampel {result.sampled_rows.toLocaleString("id-ID")} baris)
                    </span>
                  )}
                </span>
              </div>

              <div className={`grid grid-cols-1 ${SUMMARY_GRID_CLASS[summaryGridCols]} gap-2.5`}>
                {result.column_profiles
                  .filter((p) => !hiddenColumns.includes(p.column))
                  .map((p) => (
                  <div key={p.column} className="dbx-glass rounded-lg p-3">
                    <p className="text-xs font-mono text-cyan truncate mb-1.5">{p.column}</p>
                    <div className="text-[11px] text-text-muted space-y-0.5">
                      {visibleStats.nullInfo && (
                        <p>
                          Null: {p.null_count.toLocaleString("id-ID")} ({p.null_pct}%)
                        </p>
                      )}
                      {visibleStats.distinct && (
                        <p>Distinct: {p.distinct_count.toLocaleString("id-ID")}</p>
                      )}
                      {p.kind === "numeric" && (visibleStats.minMax || visibleStats.avg) && (
                        <p>
                          {visibleStats.minMax && (
                            <>
                              Min {typeof p.min === "number" ? p.min.toLocaleString("id-ID") : p.min} · Max{" "}
                              {typeof p.max === "number" ? p.max.toLocaleString("id-ID") : p.max}
                            </>
                          )}
                          {visibleStats.minMax && visibleStats.avg && " · "}
                          {visibleStats.avg && (
                            <>
                              Avg{" "}
                              {typeof p.avg === "number"
                                ? p.avg.toLocaleString("id-ID", { maximumFractionDigits: 2 })
                                : p.avg}
                            </>
                          )}
                        </p>
                      )}
                      {p.kind === "temporal" && visibleStats.minMax && (
                        <p>
                          {p.min} → {p.max}
                        </p>
                      )}
                      {p.kind === "text" && visibleStats.topValues && p.top_values && p.top_values.length > 0 && (
                        <div className="pt-1">
                          {topValuesCount === "all" ? (
                            <button
                              onClick={() => setViewingColumn(p.column)}
                              className="text-cyan hover:underline"
                            >
                              Lihat semua ({p.distinct_count.toLocaleString("id-ID")})
                            </button>
                          ) : (
                            <>
                              {p.top_values.slice(0, topValuesCount).map((tv) => (
                                <p key={tv.value} className="truncate">
                                  <span className="text-text">{tv.value}</span> ×
                                  {tv.count.toLocaleString("id-ID")}
                                </p>
                              ))}
                              {p.distinct_count > Math.min(topValuesCount, p.top_values.length) && (
                                <button
                                  onClick={() => setViewingColumn(p.column)}
                                  className="text-cyan hover:underline mt-0.5"
                                >
                                  Lihat semua ({p.distinct_count.toLocaleString("id-ID")})
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {!visibleStats.nullInfo &&
                        !visibleStats.distinct &&
                        !visibleStats.minMax &&
                        !visibleStats.avg &&
                        !visibleStats.topValues && (
                          <p className="text-text-faint italic">— tidak ada statistik ditampilkan —</p>
                        )}
                    </div>
                  </div>
                ))}
              </div>
              {hiddenColumns.length === result.column_profiles.length && (
                <p className="text-xs text-text-faint text-center py-6">
                  Semua kolom disembunyikan.{" "}
                  <button onClick={() => setHiddenColumns([])} className="text-cyan hover:underline">
                    Tampilkan semua
                  </button>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </GlassCard>

    {/* Rendered outside "Ringkasan Tabel"'s collapse — hiding the summary
        panel above should not hide the report; each has its own hide
        toggle now (Laporan's is inside ReportPanel itself). */}
    {result && (
      <ReportPanel
        key={`${connectionId}|${source === "table" ? `${schema}.${table}` : savedQueryId}|${reportResetToken}`}
        source={
          source === "table" ? { connectionId, schema, table } : { connectionId, savedQueryId }
        }
        columns={result.columns}
        columnProfiles={result.column_profiles}
        initialItems={reportMatchesInitial ? initialReport?.items : undefined}
        initialResults={reportMatchesInitial ? initialReport?.results : undefined}
      />
    )}

    {viewingColumn && (
      <ColumnValuesModal
        source={
          source === "table" ? { connectionId, schema, table } : { connectionId, savedQueryId }
        }
        column={viewingColumn}
        onClose={() => setViewingColumn(null)}
      />
    )}
    </>
  );
}
