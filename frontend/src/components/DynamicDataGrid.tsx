"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Columns3,
  Maximize2,
  Minimize2,
  RefreshCw,
  ClipboardCopy,
  CheckSquare,
  Square,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { GridFilter, FilterBar } from "./FilterBar";
import { ExportMenu } from "./ExportMenu";

const MIN_COL_WIDTH = 90;
const DEFAULT_COL_WIDTH = 160;

export function DynamicDataGrid({
  columns,
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading,
  sortColumn,
  sortDir,
  onSortChange,
  filters,
  onFiltersChange,
  onRefresh,
  onAddRow,
  onEditRow,
  onDeleteRow,
  onDeleteSelected,
  onExportCurrent,
  onExportAll,
  exporting,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loading?: boolean;
  sortColumn?: string;
  sortDir?: "asc" | "desc";
  onSortChange?: (column: string, dir: "asc" | "desc" | undefined) => void;
  filters?: GridFilter[];
  onFiltersChange?: (filters: GridFilter[]) => void;
  onRefresh?: () => void;
  onAddRow?: () => void;
  onEditRow?: (row: Record<string, unknown>) => void;
  onDeleteRow?: (row: Record<string, unknown>) => void;
  // Bulk-delete: called with the currently checked rows plus a callback the
  // caller invokes once the deletion has actually gone through, so the
  // checkboxes only clear on success (a failed/cancelled delete leaves the
  // selection intact for the user to retry).
  onDeleteSelected?: (rows: Record<string, unknown>[], clearSelection: () => void) => void;
  onExportCurrent?: (format: "csv" | "json" | "excel") => void;
  onExportAll?: (format: "csv" | "json" | "excel") => void;
  exporting?: boolean;
}) {
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [colOrder, setColOrder] = useState<string[]>(columns);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [colVisible, setColVisible] = useState<Record<string, boolean>>({});
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fullscreen, setFullscreen] = useState(false);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  // Reset column layout state whenever the underlying column set changes
  // (i.e. a different table was selected).
  useEffect(() => {
    setColOrder(columns);
    setColVisible(Object.fromEntries(columns.map((c) => [c, true])));
    setColWidths({});
    setSelected(new Set());
  }, [columns]);

  const visibleOrderedCols = colOrder.filter((c) => colVisible[c] !== false);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function copyCell(key: string, value: unknown) {
    navigator.clipboard?.writeText(value === null || value === undefined ? "" : String(value));
    setCopiedCell(key);
    setTimeout(() => setCopiedCell((k) => (k === key ? null : k)), 900);
  }

  function copyRow(row: Record<string, unknown>) {
    const line = visibleOrderedCols
      .map((c) => (row[c] === null || row[c] === undefined ? "" : String(row[c])))
      .join("\t");
    navigator.clipboard?.writeText(line);
  }

  function copySelected() {
    const header = visibleOrderedCols.join("\t");
    const lines = [...selected]
      .sort((a, b) => a - b)
      .map((i) =>
        visibleOrderedCols
          .map((c) => (rows[i]?.[c] === null || rows[i]?.[c] === undefined ? "" : String(rows[i][c])))
          .join("\t")
      );
    navigator.clipboard?.writeText([header, ...lines].join("\n"));
  }

  function toggleSort(col: string) {
    if (!onSortChange) return;
    if (sortColumn !== col) return onSortChange(col, "asc");
    if (sortDir === "asc") return onSortChange(col, "desc");
    return onSortChange(col, undefined);
  }

  function toggleSelectAll() {
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((_, i) => i))));
  }

  function toggleSelectRow(i: number) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function deleteSelected() {
    if (!onDeleteSelected) return;
    const rowsToDelete = [...selected].sort((a, b) => a - b).map((i) => rows[i]);
    onDeleteSelected(rowsToDelete, () => setSelected(new Set()));
  }

  // --- column resize ---
  function startResize(e: React.MouseEvent, col: string) {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = colWidths[col] ?? DEFAULT_COL_WIDTH;
    resizingRef.current = { col, startX: e.clientX, startWidth };

    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(MIN_COL_WIDTH, resizingRef.current.startWidth + delta);
      setColWidths((w) => ({ ...w, [resizingRef.current!.col]: newWidth }));
    }
    function onUp() {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // --- column reorder (drag & drop) ---
  function onDragStart(col: string) {
    setDragCol(col);
  }
  function onDragOverCol(e: React.DragEvent, col: string) {
    e.preventDefault();
    if (!dragCol || dragCol === col) return;
    setColOrder((order) => {
      const from = order.indexOf(dragCol);
      const to = order.indexOf(col);
      if (from === -1 || to === -1) return order;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, dragCol);
      return next;
    });
  }
  function onDragEnd() {
    setDragCol(null);
  }

  const gridContainerClass = fullscreen
    ? "fixed inset-0 z-40 bg-void flex flex-col"
    : "flex flex-col h-full";

  return (
    <div className={gridContainerClass}>
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border-glass">
        <div className="flex items-center gap-1.5">
          {selected.size > 0 ? (
            <>
              <button
                onClick={copySelected}
                className="flex items-center gap-1.5 text-xs text-cyan border border-cyan/30 rounded-lg px-2.5 py-1 hover:bg-cyan/10 transition-colors"
              >
                <ClipboardCopy size={12} />
                Copy {selected.size} row{selected.size > 1 ? "s" : ""}
              </button>
              {onDeleteSelected && (
                <button
                  onClick={deleteSelected}
                  className="flex items-center gap-1.5 text-xs text-danger border border-danger/30 rounded-lg px-2.5 py-1 hover:bg-danger/10 transition-colors"
                >
                  <Trash2 size={12} />
                  Hapus {selected.size} baris
                </button>
              )}
            </>
          ) : (
            <span className="text-xs text-text-faint">{total.toLocaleString("id-ID")} baris</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {onExportCurrent && (
            <ExportMenu onExportCurrent={onExportCurrent} onExportAll={onExportAll} busy={exporting} />
          )}
          {onAddRow && (
            <button
              onClick={onAddRow}
              className="flex items-center gap-1.5 text-xs text-cyan border border-cyan/30 rounded-lg px-2.5 py-1.5 hover:bg-cyan/10 transition-colors"
            >
              <Plus size={13} />
              Add Row
            </button>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh"
              className="text-text-faint hover:text-cyan transition-colors p-1.5"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setColumnsMenuOpen((o) => !o)}
              title="Column visibility"
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text border border-border-glass rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <Columns3 size={13} />
              Columns
            </button>
            {columnsMenuOpen && (
              <div className="absolute right-0 top-full mt-1 dbx-glass-strong rounded-lg py-1.5 min-w-[180px] max-h-64 overflow-auto dbx-scrollbar z-20">
                {colOrder.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColVisible((v) => ({ ...v, [c]: v[c] === false }))}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-panel/60 transition-colors"
                  >
                    {colVisible[c] !== false ? (
                      <CheckSquare size={13} className="text-cyan" />
                    ) : (
                      <Square size={13} className="text-text-faint" />
                    )}
                    <span className="font-mono truncate">{c}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="text-text-faint hover:text-cyan transition-colors p-1.5"
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {onFiltersChange && (
        <FilterBar columns={visibleOrderedCols} filters={filters ?? []} onChange={onFiltersChange} />
      )}

      <div className="flex-1 overflow-auto dbx-scrollbar">
        <table
          className="text-sm border-collapse"
          style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}
        >
          <thead className="sticky top-0 z-10">
            <tr className="dbx-glass-strong">
              <th className="w-9 px-2 py-2.5 border-b border-border-glass">
                <button onClick={toggleSelectAll} className="text-text-faint hover:text-cyan">
                  {selected.size === rows.length && rows.length > 0 ? (
                    <CheckSquare size={13} className="text-cyan" />
                  ) : (
                    <Square size={13} />
                  )}
                </button>
              </th>
              {visibleOrderedCols.map((col) => {
                const width = colWidths[col] ?? DEFAULT_COL_WIDTH;
                const isSorted = sortColumn === col;
                return (
                  <th
                    key={col}
                    draggable
                    onDragStart={() => onDragStart(col)}
                    onDragOver={(e) => onDragOverCol(e, col)}
                    onDragEnd={onDragEnd}
                    style={{ width }}
                    className={`relative text-left font-medium text-text-muted text-xs uppercase tracking-wide px-3 py-2.5 border-b border-border-glass whitespace-nowrap select-none cursor-grab ${
                      dragCol === col ? "opacity-40" : ""
                    }`}
                  >
                    <button
                      onClick={() => toggleSort(col)}
                      className="flex items-center gap-1 hover:text-text transition-colors"
                    >
                      <span className="truncate">{col}</span>
                      {isSorted ? (
                        sortDir === "asc" ? (
                          <ArrowUp size={11} className="text-cyan shrink-0" />
                        ) : (
                          <ArrowDown size={11} className="text-cyan shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="text-text-faint/50 shrink-0" />
                      )}
                    </button>
                    <div
                      onMouseDown={(e) => startResize(e, col)}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-cyan/40"
                    />
                  </th>
                );
              })}
              <th className="w-16 px-2 py-2.5 border-b border-border-glass" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleOrderedCols.length + 2} className="text-center text-text-muted text-sm py-10">
                  Memuat data…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleOrderedCols.length + 2} className="text-center text-text-faint text-sm py-10">
                  Tidak ada baris data.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b border-border-glass/60 hover:bg-panel/40 group ${
                    selected.has(i) ? "bg-cyan/5" : ""
                  }`}
                >
                  <td className="px-2 py-2">
                    <button onClick={() => toggleSelectRow(i)} className="text-text-faint hover:text-cyan">
                      {selected.has(i) ? (
                        <CheckSquare size={13} className="text-cyan" />
                      ) : (
                        <Square size={13} className="opacity-0 group-hover:opacity-100" />
                      )}
                    </button>
                  </td>
                  {visibleOrderedCols.map((col) => {
                    const key = `${i}-${col}`;
                    const value = row[col];
                    const width = colWidths[col] ?? DEFAULT_COL_WIDTH;
                    return (
                      <td
                        key={col}
                        onClick={() => copyCell(key, value)}
                        title="Klik untuk salin"
                        style={{ width }}
                        className="px-3 py-2 font-mono text-[13px] text-text overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer relative"
                      >
                        {value === null ? (
                          <span className="text-text-faint italic">null</span>
                        ) : (
                          String(value)
                        )}
                        {copiedCell === key && (
                          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-cyan flex items-center gap-1 bg-void px-1">
                            <Copy size={10} /> disalin
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => copyRow(row)}
                        title="Salin baris"
                        className="text-text-faint hover:text-cyan"
                      >
                        <ClipboardCopy size={13} />
                      </button>
                      {onEditRow && (
                        <button
                          onClick={() => onEditRow(row)}
                          title="Edit baris"
                          className="text-text-faint hover:text-cyan"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {onDeleteRow && (
                        <button
                          onClick={() => onDeleteRow(row)}
                          title="Hapus baris"
                          className="text-text-faint hover:text-danger"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 flex items-center justify-between border-t border-border-glass px-4 py-2.5 text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <span>{total.toLocaleString("id-ID")} baris</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="bg-void-2 border border-border-glass rounded px-2 py-1 text-xs text-text"
          >
            {[25, 50, 100, 250, 500].map((n) => (
              <option key={n} value={n}>
                {n}/page
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="disabled:opacity-30 hover:text-text transition-colors"
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            Halaman {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="disabled:opacity-30 hover:text-text transition-colors"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
