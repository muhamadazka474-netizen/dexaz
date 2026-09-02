"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  Sigma,
  Loader2,
  FileBarChart2,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Check,
  Pencil,
  GripVertical,
} from "lucide-react";
import { GlassCard } from "@/components/ui";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  ApiError,
  ColumnProfile,
  ReportGroupedResult,
  ReportTotalsResult,
} from "@/lib/api";
import { useTheme } from "@/lib/theme-context";

export const REPORT_STORAGE_KEY = "dbx:dashboard-report-state";
// Own collapse/hide flag — deliberately separate from the "Ringkasan Tabel"
// panel's collapsed state (dbx:dashboard-summary-collapsed) so hiding one
// doesn't hide the other.
const REPORT_COLLAPSED_KEY = "dbx:dashboard-report-collapsed";

type ChartKind = "column" | "pie" | "line" | "total";
type Agg = "sum" | "avg" | "count" | "min" | "max";
type SortOrder = "value_desc" | "value_asc" | "label_asc" | "label_desc";

const CHART_COLORS = ["#2dd4f0", "#4f8cff", "#9b6bff", "#34d399", "#fbbf24", "#f76a6a"];

// Tooltip colors are picked explicitly per theme (rather than left to
// recharts' defaults) — the previous hardcoded dark box made hover values
// unreadable once the app got a light theme, since the text color didn't
// track the background.
const TOOLTIP_STYLE = {
  dark: {
    contentStyle: {
      background: "#111830",
      border: "1px solid rgba(148,178,255,0.35)",
      borderRadius: 8,
      fontSize: 12,
    },
    itemStyle: { color: "#e6ecf7" },
    labelStyle: { color: "#e6ecf7" },
  },
  light: {
    contentStyle: {
      background: "#ffffff",
      border: "1px solid rgba(30,41,59,0.18)",
      borderRadius: 8,
      fontSize: 12,
      boxShadow: "0 4px 16px rgba(16,24,40,0.12)",
    },
    itemStyle: { color: "#101828" },
    labelStyle: { color: "#101828" },
  },
} as const;

const AGG_LABEL: Record<Agg, string> = {
  sum: "Total (SUM)",
  avg: "Rata-rata (AVG)",
  count: "Jumlah baris (COUNT)",
  min: "Minimum",
  max: "Maksimum",
};

const SORT_LABEL: Record<SortOrder, string> = {
  value_desc: "Nilai: Tertinggi ke Terendah",
  value_asc: "Nilai: Terendah ke Tertinggi",
  label_asc: "Label/Tanggal: Terlama ke Terbaru (A–Z)",
  label_desc: "Label/Tanggal: Terbaru ke Terlama (Z–A)",
};

const KIND_META: Record<ChartKind, { label: string; icon: typeof BarChart3 }> = {
  column: { label: "Column", icon: BarChart3 },
  pie: { label: "Pie", icon: PieChartIcon },
  line: { label: "Line", icon: LineChartIcon },
  total: { label: "Total Nominal", icon: Sigma },
};

// Static class strings (not computed at runtime) so Tailwind's build-time
// scanner actually picks them up — a dynamically-built class like
// `lg:grid-cols-${n}` would silently not exist in the compiled CSS.
const GRID_COLS_CLASS: Record<1 | 2 | 3, string> = {
  1: "",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
};
const WIDE_SPAN_CLASS: Record<1 | 2 | 3, string> = {
  1: "",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
};

export interface ReportSource {
  connectionId: string;
  schema?: string;
  table?: string;
  savedQueryId?: string;
}

// One chart/total the user has added to the report. `groupBy` etc. are set
// for chart items (column/pie/line); `columns` is set for total items.
export interface ReportItem {
  id: string;
  kind: ChartKind;
  label: string;
  groupBy?: string;
  valueColumn?: string;
  agg?: Agg;
  limit?: number;
  showAll?: boolean;
  sort?: SortOrder;
  columns?: string[];
}

export type ItemResult =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "grouped"; data: ReportGroupedResult }
  | { status: "totals"; data: ReportTotalsResult };

// Unique id per report item. Not a simple incrementing counter — a report
// restored from localStorage can already contain ids like "item-3", and a
// module-level counter would restart at 0 on every fresh page load and
// eventually collide with those restored ids.
function nextItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `item-${crypto.randomUUID()}`;
  }
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ReportPanel({
  source,
  columns,
  columnProfiles,
  initialItems,
  initialResults,
}: {
  source: ReportSource;
  columns: string[];
  columnProfiles: ColumnProfile[];
  // Report data already restored from localStorage by the parent (which
  // reads it in the very same synchronous pass where it also restores
  // connectionId/schema/table — see TableSummaryPanel). Seeding state from
  // a prop like this, read once via the lazy useState initializer below,
  // avoids the previous approach of restoring via a useEffect keyed off a
  // derived `sourceKey`: that had to wait for the right prop values to
  // arrive from the parent across several renders, which was a real race
  // (the report could restore against a stale/partial source and silently
  // no-op). The parent also puts `sourceKey` into this component's `key`,
  // so switching table/connection naturally remounts this component with
  // fresh state instead of needing an effect to detect the change.
  initialItems?: ReportItem[];
  initialResults?: Record<string, ItemResult>;
}) {
  const { mode: theme } = useTheme();
  const numericColumns = useMemo(
    () => columnProfiles.filter((p) => p.kind === "numeric").map((p) => p.column),
    [columnProfiles]
  );
  // Identifies the current source (which table/saved query the report is
  // built on) — used only to persist the report under the right key.
  const sourceKey = useMemo(() => JSON.stringify(source), [source]);

  // Staging area — the chart/total currently being configured, not yet
  // added to the report.
  const [chartKind, setChartKind] = useState<ChartKind>("column");
  const [groupBy, setGroupBy] = useState(
    () => columnProfiles.find((p) => p.kind !== "numeric")?.column ?? columns[0] ?? ""
  );
  const [valueColumn, setValueColumn] = useState(() => numericColumns[0] ?? "");
  const [agg, setAgg] = useState<Agg>("sum");
  const [limit, setLimit] = useState(10);
  const [showAllData, setShowAllData] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("value_desc");
  const [totalColumns, setTotalColumns] = useState<string[]>(() => numericColumns.slice(0, 4));
  const [stageError, setStageError] = useState<string | null>(null);

  // Whether the Laporan panel itself is hidden. Separate from "Ringkasan
  // Tabel"'s own collapsed state and restored from its own localStorage key
  // on mount, so collapsing one panel never affects the other.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(REPORT_COLLAPSED_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(REPORT_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  // The report itself — every chart/total the user has added, plus their
  // fetched results once "Buat Laporan" runs. Seeded synchronously from
  // whatever the parent already restored for this exact source, so there's
  // no gap where the report appears empty before catching up.
  const [items, setItems] = useState<ReportItem[]>(() => initialItems ?? []);
  const [results, setResults] = useState<Record<string, ItemResult>>(() => initialResults ?? {});
  const [building, setBuilding] = useState(false);

  // Report title and grid layout (1/2/3 columns) — restored directly here
  // rather than lifted to the parent like items/results. This is safe: by
  // the time this component mounts, the parent's `source` prop is already
  // fully resolved (see the long comment on the `initialItems` prop above),
  // and this instance's `sourceKey` never changes during its lifetime (a
  // real change remounts it via `key`), so there's no async gap to race.
  const [title, setTitle] = useState<string>(() => {
    try {
      const raw = window.localStorage.getItem(REPORT_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.sourceKey === sourceKey) return saved.title ?? "";
      }
    } catch {
      // ignore
    }
    return "";
  });
  const [gridCols, setGridCols] = useState<1 | 2 | 3>(() => {
    try {
      const raw = window.localStorage.getItem(REPORT_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.sourceKey === sourceKey && [1, 2, 3].includes(saved.gridCols)) return saved.gridCols;
      }
    } catch {
      // ignore
    }
    return 2;
  });

  // Which item (if any) is being edited — its saved config is loaded back
  // into the staging area above, and "Tambah ke Laporan" becomes "Simpan
  // Perubahan" so re-configuring an item doesn't mean delete-then-recreate.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which item is currently being dragged, for reordering via native
  // drag-and-drop on the rendered report cards.
  const [dragId, setDragId] = useState<string | null>(null);

  // Persist the report (minus any items still mid-flight) after every
  // change, so a refresh doesn't lose what's been built.
  useEffect(() => {
    try {
      if (items.length === 0 && !title) {
        window.localStorage.removeItem(REPORT_STORAGE_KEY);
        return;
      }
      const persistableResults: Record<string, ItemResult> = {};
      for (const [id, res] of Object.entries(results)) {
        if (res.status !== "loading") persistableResults[id] = res;
      }
      window.localStorage.setItem(
        REPORT_STORAGE_KEY,
        JSON.stringify({ sourceKey, title, gridCols, items, results: persistableResults })
      );
    } catch {
      // ignore (storage full/unavailable)
    }
  }, [sourceKey, title, gridCols, items, results]);

  function toggleTotalColumn(col: string) {
    setTotalColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  }

  const canAdd =
    chartKind === "total"
      ? totalColumns.length > 0
      : !!groupBy && (agg === "count" || !!valueColumn);

  function buildItemFromStage(id: string): ReportItem {
    if (chartKind === "total") {
      return {
        id,
        kind: "total",
        label: `Total: ${totalColumns.join(", ")}`,
        columns: [...totalColumns],
      };
    }
    const aggLabel = agg === "count" ? "Jumlah baris" : `${AGG_LABEL[agg]}(${valueColumn})`;
    return {
      id,
      kind: chartKind,
      label: `${KIND_META[chartKind].label}: ${groupBy} — ${aggLabel}${
        showAllData ? " (semua data)" : ""
      }`,
      groupBy,
      valueColumn: agg === "count" ? undefined : valueColumn,
      agg,
      limit,
      showAll: showAllData,
      sort: sortOrder,
    };
  }

  async function fetchItemResult(it: ReportItem): Promise<ItemResult> {
    try {
      if (it.kind === "total") {
        const data = await api.dashboardReportTotals({ ...source, columns: it.columns ?? [] });
        return { status: "totals", data };
      }
      const data = await api.dashboardReportGrouped({
        ...source,
        groupBy: it.groupBy ?? "",
        valueColumn: it.valueColumn,
        agg: it.agg ?? "sum",
        limit: it.limit,
        all: it.showAll,
        sort: it.sort ?? "value_desc",
      });
      return { status: "grouped", data };
    } catch (e) {
      return { status: "error", message: e instanceof ApiError ? e.message : "Gagal memuat data" };
    }
  }

  function addItem() {
    setStageError(null);
    if (!canAdd) {
      setStageError(
        chartKind === "total"
          ? "Pilih minimal satu kolom angka"
          : "Lengkapi kolom pengelompokan dan kolom nilai terlebih dahulu"
      );
      return;
    }

    if (editingId) {
      // Editing an existing item: replace its config in place (keeping its
      // position in the report) instead of appending a new one, then
      // re-fetch just this item so the chart reflects the change right
      // away without needing a full "Buat Laporan" re-run.
      const updated = buildItemFromStage(editingId);
      setItems((prev) => prev.map((it) => (it.id === editingId ? updated : it)));
      setResults((prev) => ({ ...prev, [editingId]: { status: "loading" } }));
      fetchItemResult(updated).then((res) => {
        setResults((prev) => ({ ...prev, [editingId]: res }));
      });
      setEditingId(null);
      return;
    }

    const id = nextItemId();
    setItems((prev) => [...prev, buildItemFromStage(id)]);
  }

  function startEdit(item: ReportItem) {
    setStageError(null);
    setChartKind(item.kind);
    if (item.kind === "total") {
      setTotalColumns(item.columns ?? []);
    } else {
      setGroupBy(item.groupBy ?? "");
      setValueColumn(item.valueColumn ?? "");
      setAgg(item.agg ?? "sum");
      setLimit(item.limit ?? 10);
      setShowAllData(!!item.showAll);
      setSortOrder(item.sort ?? "value_desc");
    }
    setEditingId(item.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setStageError(null);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (editingId === id) cancelEdit();
  }

  function renameItem(id: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, label: trimmed } : it)));
  }

  function moveItem(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    setItems((prev) => {
      const fromIdx = prev.findIndex((it) => it.id === draggedId);
      const toIdx = prev.findIndex((it) => it.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  async function handleBuildReport() {
    if (items.length === 0) return;
    setBuilding(true);
    setResults(Object.fromEntries(items.map((it) => [it.id, { status: "loading" as const }])));

    await Promise.all(
      items.map(async (it) => {
        const res = await fetchItemResult(it);
        setResults((prev) => ({ ...prev, [it.id]: res }));
      })
    );

    setBuilding(false);
  }

  return (
    <GlassCard className="p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <FileBarChart2 size={16} className="text-violet shrink-0" />
          <h2 className="font-display text-base text-text truncate">{title || "Laporan"}</h2>
        </div>
        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Tampilkan panel" : "Sembunyikan panel"}
          className="flex items-center justify-center h-7 w-7 rounded-lg text-text-muted hover:text-text hover:bg-panel/60 border border-border-glass transition-colors shrink-0"
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {collapsed ? (
        <p className="text-xs text-text-faint">
          Panel disembunyikan.{" "}
          <button onClick={toggleCollapsed} className="text-violet hover:underline">
            Tampilkan kembali
          </button>
          {items.length > 0 && ` — ${items.length} item laporan masih tersimpan.`}
        </p>
      ) : (
        <>
        <div className="mb-4">
          <label className="block text-[11px] text-text-muted mb-1">Judul laporan (opsional)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Contoh: Laporan Penjualan Bulanan"
            className="dbx-input text-sm max-w-sm"
          />
        </div>
        {/* --- Builder: configure one chart/total at a time, then add it --- */}
        <div className="dbx-glass rounded-lg p-4 mb-4">
          <p className="text-[11px] uppercase tracking-[0.1em] text-text-faint mb-3">
            {editingId ? "Ubah pengaturan item" : "Tambah diagram atau total ke laporan"}
          </p>

          <div className="flex items-center gap-1 dbx-glass rounded-lg p-1 mb-3 w-fit">
            {(Object.keys(KIND_META) as ChartKind[]).map((key) => {
              const Icon = KIND_META[key].icon;
              return (
                <button
                  key={key}
                  onClick={() => setChartKind(key)}
                  className={`flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 transition-colors ${
                    chartKind === key ? "bg-violet/15 text-violet" : "text-text-muted hover:text-text"
                  }`}
                >
                  <Icon size={12} /> {KIND_META[key].label}
                </button>
              );
            })}
          </div>

          {chartKind === "total" ? (
            <div className="mb-3">
              <label className="block text-[11px] text-text-muted mb-1.5">
                Kolom angka untuk dijumlahkan
              </label>
              {numericColumns.length === 0 ? (
                <p className="text-xs text-text-faint">Tidak ada kolom numerik pada sumber ini.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {numericColumns.map((col) => (
                    <button
                      key={col}
                      onClick={() => toggleTotalColumn(col)}
                      className={`text-xs font-mono rounded-md px-2.5 py-1.5 border transition-colors ${
                        totalColumns.includes(col)
                          ? "border-violet/40 bg-violet/15 text-violet"
                          : "border-border-glass text-text-muted hover:text-text"
                      }`}
                    >
                      {col}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2.5 mb-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1">
                  Kelompokkan berdasarkan
                </label>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value)}
                  className="dbx-input w-40 text-xs"
                >
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-text-muted mb-1">Fungsi agregasi</label>
                <select
                  value={agg}
                  onChange={(e) => setAgg(e.target.value as Agg)}
                  className="dbx-input w-40 text-xs"
                >
                  {(Object.keys(AGG_LABEL) as Agg[]).map((a) => (
                    <option key={a} value={a}>
                      {AGG_LABEL[a]}
                    </option>
                  ))}
                </select>
              </div>

              {agg !== "count" && (
                <div>
                  <label className="block text-[11px] text-text-muted mb-1">Kolom nilai</label>
                  <select
                    value={valueColumn}
                    onChange={(e) => setValueColumn(e.target.value)}
                    className="dbx-input w-40 text-xs"
                  >
                    <option value="">-- pilih kolom --</option>
                    {numericColumns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[11px] text-text-muted mb-1">
                  {chartKind === "line" ? "Jumlah titik data" : "Top N kategori"}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={limit}
                    disabled={showAllData}
                    onChange={(e) => setLimit(Number(e.target.value) || 10)}
                    className="dbx-input w-20 text-xs disabled:opacity-40"
                  />
                  <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showAllData}
                      onChange={(e) => setShowAllData(e.target.checked)}
                      className="accent-violet"
                    />
                    Tampilkan semua data
                  </label>
                </div>
                {showAllData && (
                  <p className="text-[10px] text-text-faint mt-1">
                    Tidak dibatasi — mengambil seluruh kategori (dibatasi hanya oleh batas aman kueri).
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] text-text-muted mb-1">Urutan</label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  className="dbx-input w-56 text-xs"
                >
                  {(Object.keys(SORT_LABEL) as SortOrder[]).map((s) => (
                    <option key={s} value={s}>
                      {SORT_LABEL[s]}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-text-faint mt-1">
                  Pilih &quot;Label/Tanggal&quot; kalau kolom pengelompokan berupa tanggal — urutkan
                  dari yang terlama atau terbaru, bukan berdasarkan nilai agregatnya.
                </p>
              </div>
            </div>
          )}

          {stageError && <p className="text-xs text-danger mb-2">{stageError}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={addItem}
              className={`flex items-center gap-1.5 rounded-lg border text-xs px-3 py-1.5 transition-colors ${
                editingId
                  ? "bg-violet/15 border-violet/40 text-violet hover:opacity-90"
                  : "dbx-glass border-border-glass-strong text-text hover:border-violet/40 hover:text-violet"
              }`}
            >
              {editingId ? <Check size={13} /> : <Plus size={13} />}
              {editingId ? "Simpan Perubahan" : "Tambah ke Laporan"}
            </button>
            {editingId && (
              <button
                onClick={cancelEdit}
                className="text-xs text-text-muted hover:text-text px-2 py-1.5 transition-colors"
              >
                Batal
              </button>
            )}
          </div>
        </div>

        {/* --- List of items queued for this report --- */}
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {items.map((it) => {
              const Icon = KIND_META[it.kind].icon;
              const isEditing = editingId === it.id;
              return (
                <span
                  key={it.id}
                  className={`flex items-center gap-1.5 text-xs rounded-full border pl-2.5 pr-1.5 py-1 transition-colors ${
                    isEditing
                      ? "border-violet/50 bg-violet/10 text-violet"
                      : "border-border-glass-strong text-text-muted"
                  }`}
                >
                  <Icon size={11} className="text-violet" />
                  {it.label}
                  <button
                    onClick={() => startEdit(it)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-panel/60 hover:text-text transition-colors"
                    aria-label="Ubah item"
                    title="Ubah pengaturan"
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    onClick={() => removeItem(it.id)}
                    className="rounded-full p-0.5 hover:bg-danger/15 hover:text-danger transition-colors"
                    aria-label="Hapus dari laporan"
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <button
            onClick={handleBuildReport}
            disabled={items.length === 0 || building}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet to-blue text-void font-medium text-xs px-3.5 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {building ? <Loader2 size={13} className="animate-spin" /> : <FileBarChart2 size={13} />}
            Buat Laporan{items.length > 0 ? ` (${items.length})` : ""}
          </button>

          {Object.keys(results).length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-text-faint mr-0.5">Tata letak:</span>
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setGridCols(n)}
                  title={`${n} kolom`}
                  className={`flex items-center justify-center h-6 w-6 rounded-md text-[11px] border transition-colors ${
                    gridCols === n
                      ? "border-violet/40 bg-violet/15 text-violet"
                      : "border-border-glass text-text-muted hover:text-text"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* --- The report itself: every added item rendered together. Drag
            a card by its handle to reorder; drop targets are the other
            cards themselves (native HTML5 drag-and-drop, no extra library
            needed for a simple reorder-within-one-list). --- */}
        {Object.keys(results).length > 0 && (
          <div className={`grid grid-cols-1 ${GRID_COLS_CLASS[gridCols]} gap-4`}>
            {items.map((it) => {
              const res = results[it.id];
              if (!res) return null;
              return (
                <ReportItemCard
                  key={it.id}
                  item={it}
                  result={res}
                  wide={it.kind === "total"}
                  wideSpanClass={WIDE_SPAN_CLASS[gridCols]}
                  theme={theme}
                  dragging={dragId === it.id}
                  onDragStart={() => setDragId(it.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOverItem={() => {
                    if (dragId && dragId !== it.id) moveItem(dragId, it.id);
                  }}
                  onEdit={() => startEdit(it)}
                  onRemove={() => removeItem(it.id)}
                  onRename={(label) => renameItem(it.id, label)}
                />
              );
            })}
          </div>
        )}
        </>
      )}
    </GlassCard>
  );
}

function ReportItemCard({
  item,
  result,
  wide,
  wideSpanClass,
  theme,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOverItem,
  onEdit,
  onRemove,
  onRename,
}: {
  item: ReportItem;
  result: ItemResult;
  wide: boolean;
  wideSpanClass: string;
  theme: "dark" | "light";
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverItem: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRename: (label: string) => void;
}) {
  const Icon = KIND_META[item.kind].icon;
  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState(item.label);

  useEffect(() => {
    if (!renaming) setDraftLabel(item.label);
  }, [item.label, renaming]);

  function commitRename() {
    setRenaming(false);
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== item.label) onRename(trimmed);
    else setDraftLabel(item.label);
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverItem();
      }}
      className={`dbx-glass rounded-lg p-4 transition-opacity ${wide ? wideSpanClass : ""} ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 mb-3">
        <span className="cursor-grab active:cursor-grabbing text-text-faint hover:text-text-muted -ml-1" title="Seret untuk mengatur urutan">
          <GripVertical size={13} />
        </span>
        <Icon size={13} className="text-violet shrink-0" />
        {renaming ? (
          <input
            autoFocus
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraftLabel(item.label);
                setRenaming(false);
              }
            }}
            className="text-xs text-text font-medium flex-1 min-w-0 bg-panel/60 border border-violet/40 rounded px-1.5 py-0.5 outline-none focus:border-violet"
          />
        ) : (
          <p
            onDoubleClick={() => setRenaming(true)}
            title="Klik dua kali untuk mengubah nama"
            className="text-xs text-text font-medium truncate flex-1 cursor-text"
          >
            {item.label}
          </p>
        )}
        <div className="flex items-center gap-0.5 shrink-0">
          {!renaming && (
            <button
              onClick={() => setRenaming(true)}
              title="Ubah nama kartu"
              className="text-text-faint hover:text-text transition-colors p-1"
            >
              <Pencil size={11} />
            </button>
          )}
          <button
            onClick={onEdit}
            title="Ubah pengaturan"
            className="text-text-faint hover:text-text transition-colors p-1"
          >
            <BarChart3 size={12} />
          </button>
          <button
            onClick={onRemove}
            title="Hapus dari laporan"
            className="text-text-faint hover:text-danger transition-colors p-1"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {result.status === "loading" && (
        <div className="flex items-center gap-2 text-xs text-text-muted py-6 justify-center">
          <Loader2 size={13} className="animate-spin" /> Memuat data...
        </div>
      )}

      {result.status === "error" && (
        <div className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2">
          {result.message}
        </div>
      )}

      {result.status === "totals" && <TotalsView data={result.data} />}
      {result.status === "grouped" && (
        <GroupedChartView kind={item.kind} data={result.data} theme={theme} />
      )}
    </div>
  );
}

function TotalsView({ data }: { data: ReportTotalsResult }) {
  return (
    // `@container`: the KPI grid below sizes its columns off THIS box's
    // own rendered width rather than the viewport — so it collapses back
    // toward 2 columns whenever the report layout (1/2/3-column toggle,
    // a narrower window, a sidebar) leaves it less room, independent of
    // how wide the browser window happens to be.
    <div className="@container">
      <div className="grid grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 gap-2.5">
        {data.totals.map((t) => {
          const sumText =
            t.sum !== null ? t.sum.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : "—";
          const avgText =
            t.avg !== null ? t.avg.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : "—";
          const minText =
            t.min !== null ? t.min.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : "—";
          const maxText =
            t.max !== null ? t.max.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : "—";
          return (
            // Each KPI box is its own container ("@container/kpi"), so the
            // number's font-size below is driven by clamp()+cqw against
            // THIS box's actual pixel width — it scales continuously as
            // the box gets narrower or wider (more report columns, window
            // resize, sidebar toggling, etc.) instead of jumping between a
            // few fixed sizes picked from the digit count alone, which
            // could still overflow a box that happened to be unusually
            // narrow. `min-w-0` lets the box actually shrink inside the
            // grid instead of being held open by its content.
            <div key={t.column} className="@container/kpi dbx-glass rounded-lg p-3.5 min-w-0">
              <p className="text-[11px] font-mono text-text-muted truncate mb-1">{t.column}</p>
              <p
                className="font-display text-text tabular-nums truncate"
                style={{ fontSize: "clamp(0.7rem, 4px + 10cqw, 1.375rem)" }}
                title={sumText}
              >
                {sumText}
              </p>
              {/* Avg/Min/Max: each "label value" pair is its own flex item
                  with whitespace-nowrap, so a pair never splits awkwardly
                  mid-number — but the group as a whole wraps (flex-wrap)
                  once a pair no longer fits on the current line, instead
                  of truncating with an ellipsis and losing digits. */}
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-text-faint mt-1">
                <span className="whitespace-nowrap">Avg {avgText}</span>
                <span className="whitespace-nowrap">Min {minText}</span>
                <span className="whitespace-nowrap">Max {maxText}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-text-faint mt-2">
        Dihitung dari seluruh {data.row_count.toLocaleString("id-ID")} baris (bukan sampel).
      </p>
    </div>
  );
}

const RADIAN = Math.PI / 180;

// Shared "nominal" formatter — every number surfaced in tooltips and pie
// labels goes through this so hover values always carry full Indonesian
// thousand separators (this is the "give me the exact number" spot; there's
// always room for it in a tooltip).
function formatNominal(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

// Axis-tick formatter — deliberately SHORT ("1,2 jt" / "3,4 M" / "850 rb")
// rather than the fully-expanded number. A chart axis only ever has a
// fixed, narrow column to draw numbers in, so no amount of responsive
// sizing can guarantee a long "1.234.567.890,12"-style number will fit —
// only a shorter representation can. The full value is still one hover
// away via the tooltip (formatNominal above).
function formatCompactNominal(value: number): string {
  return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}

function clampNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function truncateLabel(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// Tracks an element's own rendered width via ResizeObserver. Every "how
// big should this text be" decision in the chart below is driven off this
// — the box's actual pixel width — rather than viewport size or category
// count alone, so it stays correct across the 1/2/3-column report layout,
// window resizing, and wherever the card ends up sitting in the grid.
function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// Custom X-axis tick: font size and rotation adapt to how many categories
// are on screen, and long category names are truncated — otherwise labels
// overlap each other once there are more than a handful of bars/points.
function AdaptiveAxisTick(props: {
  x?: number;
  y?: number;
  payload?: { value: string | number };
  fill: string;
  fontSize: number;
  rotate: boolean;
  maxChars: number;
}) {
  const { x = 0, y = 0, payload, fill, fontSize, rotate, maxChars } = props;
  const text = truncateLabel(String(payload?.value ?? ""), maxChars);
  return (
    <text
      x={x}
      y={y}
      dy={rotate ? 9 : 12}
      textAnchor={rotate ? "end" : "middle"}
      fill={fill}
      fontSize={fontSize}
      transform={rotate ? `rotate(-35, ${x}, ${y})` : undefined}
    >
      {text}
    </text>
  );
}

// Custom Y-axis (numeric) tick: same idea, but for the compact-formatted
// numbers — right-aligned against the axis line like recharts' default,
// just with a font size that's driven by the chart's actual width.
function AdaptiveNumericTick(props: {
  x?: number;
  y?: number;
  payload?: { value: number | string };
  fill: string;
  fontSize: number;
}) {
  const { x = 0, y = 0, payload, fill, fontSize } = props;
  const raw = payload?.value;
  const text = typeof raw === "number" ? formatCompactNominal(raw) : String(raw ?? "");
  return (
    <text x={x} y={y} dy={3} textAnchor="end" fill={fill} fontSize={fontSize}>
      {text}
    </text>
  );
}

// Custom pie label: positioned like recharts' default outside label, but
// with a font size that shrinks as the slice count grows and text that's
// truncated — plus very thin slices (<5%) skip their label entirely so
// they don't collide with their neighbors.
function AdaptivePieLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
  name?: string | number;
  fill: string;
  fontSize: number;
  maxChars: number;
}) {
  const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, percent = 0, name, fill, fontSize, maxChars } = props;
  if (percent < 0.05) return null;
  const radius = outerRadius + 14;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  const text = `${truncateLabel(String(name ?? ""), maxChars)} (${(percent * 100).toFixed(0)}%)`;
  return (
    <text
      x={x}
      y={y}
      fill={fill}
      fontSize={fontSize}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
    >
      {text}
    </text>
  );
}

function GroupedChartView({
  kind,
  data,
  theme,
}: {
  kind: ChartKind;
  data: ReportGroupedResult;
  theme: "dark" | "light";
}) {
  const chartData = data.labels.map((label, i) => ({ label, value: data.values[i] }));
  const tooltip = TOOLTIP_STYLE[theme];
  const tickFill = theme === "dark" ? "#8592ac" : "#47536b";
  const gridStroke = theme === "dark" ? "rgba(148,178,255,0.12)" : "rgba(30,41,59,0.12)";
  const n = chartData.length;

  const [chartWrapRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  // Before the first ResizeObserver measurement (containerWidth === 0) fall
  // back to the old category-count-based guess so nothing flashes at an
  // odd size; once measured, the card's real width takes over.
  const measured = containerWidth > 0;

  // Scale font size and rotation down as the number of categories grows —
  // keeps axis/pie text from overlapping without the user having to tweak
  // anything.
  const axisFontSize = measured
    ? clampNum(containerWidth / 42, 8, 11)
    : n > 14
    ? 8.5
    : n > 8
    ? 9.5
    : 10.5;
  const rotateAxis = n > 5;
  const axisMaxChars = measured
    ? clampNum(Math.floor(containerWidth / Math.max(n, 1) / (axisFontSize * 0.62)), 4, 16)
    : n > 14
    ? 6
    : n > 8
    ? 8
    : 12;
  const pieFontSize = measured ? clampNum(containerWidth / 46, 8, 11) : n > 10 ? 9 : n > 6 ? 9.5 : 10.5;
  const pieMaxChars = measured ? clampNum(Math.floor(containerWidth / 42), 6, 16) : n > 10 ? 8 : 12;
  const chartHeight = rotateAxis || n > 8 ? 300 : 260;
  const tooltipFormatter = (value: number | string) =>
    typeof value === "number" ? formatNominal(value) : value;

  // The Y-axis column width isn't fixed — it's sized to whatever the
  // longest *compact* tick label actually needs (e.g. "12,3 jt" needs more
  // room than "850"), so numbers never get clipped but the axis also
  // doesn't reserve more space than it has to.
  const yTickSamples = chartData.length > 0 ? chartData.map((d) => d.value) : [0];
  const maxYLabelLen = Math.max(...yTickSamples.map((v) => formatCompactNominal(v).length), 3);
  const yAxisWidth = Math.round(clampNum(maxYLabelLen * axisFontSize * 0.62 + 12, 30, 72));

  return (
    <div className="@container">
      {data.grand_total !== null && (
        <p className="text-[11px] text-text-muted mb-2 flex flex-wrap items-baseline gap-x-1">
          <span className="shrink-0">Total keseluruhan ({AGG_LABEL[data.agg]}):</span>
          {/* Same fluid, container-driven sizing as the KPI totals cards —
              scales with the card's actual width instead of a fixed size
              that could get clipped on a narrower report layout. */}
          <span
            className="text-text font-display tabular-nums truncate max-w-full"
            style={{ fontSize: "clamp(0.6875rem, 3px + 3cqw, 0.9375rem)" }}
            title={formatNominal(data.grand_total)}
          >
            {formatNominal(data.grand_total)}
          </span>
          {data.truncated && (
            <span className="text-text-faint"> — {chartData.length} kategori teratas</span>
          )}
        </p>
      )}

      <div ref={chartWrapRef} style={{ width: "100%", height: chartHeight }}>
        <ResponsiveContainer>
          {kind === "pie" ? (
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={n > 8 ? 80 : 90}
                label={(props) => (
                  <AdaptivePieLabel {...props} fill={tickFill} fontSize={pieFontSize} maxChars={pieMaxChars} />
                )}
                labelLine={{ stroke: tickFill, strokeWidth: 1 }}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltip} cursor={{ fill: "rgba(148,178,255,0.08)" }} formatter={tooltipFormatter} />
              <Legend wrapperStyle={{ fontSize: 11, color: tickFill }} />
            </PieChart>
          ) : kind === "line" ? (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: rotateAxis ? 26 : 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="label"
                interval={0}
                height={rotateAxis ? 56 : 30}
                tick={
                  <AdaptiveAxisTick fill={tickFill} fontSize={axisFontSize} rotate={rotateAxis} maxChars={axisMaxChars} />
                }
              />
              <YAxis
                tick={<AdaptiveNumericTick fill={tickFill} fontSize={axisFontSize} />}
                width={yAxisWidth}
              />
              <Tooltip {...tooltip} cursor={{ stroke: "rgba(148,178,255,0.25)" }} formatter={tooltipFormatter} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#2dd4f0"
                strokeWidth={2}
                dot={{ r: 2, fill: "#2dd4f0" }}
              />
            </LineChart>
          ) : (
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: rotateAxis ? 26 : 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="label"
                interval={0}
                height={rotateAxis ? 56 : 30}
                tick={
                  <AdaptiveAxisTick fill={tickFill} fontSize={axisFontSize} rotate={rotateAxis} maxChars={axisMaxChars} />
                }
              />
              <YAxis
                tick={<AdaptiveNumericTick fill={tickFill} fontSize={axisFontSize} />}
                width={yAxisWidth}
              />
              <Tooltip {...tooltip} cursor={{ fill: "rgba(148,178,255,0.08)" }} formatter={tooltipFormatter} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
