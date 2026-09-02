"use client";

import { useRef, useState } from "react";
import { X, Upload, FileSpreadsheet, Loader2, CheckCircle2, Trash2 } from "lucide-react";
import { api, ApiError, ExcelAnalyzeResult, ExcelImportColumn, SchemaTree } from "@/lib/api";

const COMMON_TYPES = [
  "TEXT", "VARCHAR(255)", "BIGINT", "INTEGER", "DOUBLE PRECISION", "NUMERIC(15,2)",
  "BOOLEAN", "DATE", "TIMESTAMP", "UUID", "JSON",
];

type Step = "pick_file" | "configure" | "importing" | "done";

export function ImportExcelModal({
  connectionId,
  database,
  schema,
  tree,
  onClose,
  onImported,
}: {
  connectionId: string;
  database?: string;
  schema: string;
  tree: SchemaTree | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("pick_file");
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ExcelAnalyzeResult | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [columns, setColumns] = useState<ExcelImportColumn[]>([]);
  const [mode, setMode] = useState<"create" | "append">("create");
  const [targetTable, setTargetTable] = useState("");
  const [targetSchema, setTargetSchema] = useState(schema);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ rows_imported: number; table: string } | null>(null);

  const existingTables = tree?.schemas.find((s) => s.schema === targetSchema)?.tables ?? [];

  async function runAnalyze(f: File, sheet?: string, hRow = headerRow) {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await api.analyzeExcelImport(connectionId, f, sheet, hRow);
      setAnalysis(result);
      setSelectedSheet(result.active_sheet);
      setColumns(result.columns);
      if (!targetTable) {
        const guess = f.name.replace(/\.(xlsx|xlsm)$/i, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
        setTargetTable(guess || "imported_table");
      }
      setStep("configure");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal membaca file Excel");
    } finally {
      setAnalyzing(false);
    }
  }

  function handleFileChosen(f: File) {
    setFile(f);
    setAnalysis(null);
    void runAnalyze(f, undefined, 1);
  }

  function updateColumn(idx: number, patch: Partial<ExcelImportColumn>) {
    setColumns((cols) => cols.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  async function handleImport() {
    if (!file || !analysis) return;
    setStep("importing");
    setError(null);
    try {
      const result = await api.executeExcelImport(connectionId, file, {
        sheet: selectedSheet,
        header_row: headerRow,
        schema: targetSchema,
        table: targetTable.trim(),
        mode,
        columns,
        database,
      });
      setImportResult({ rows_imported: result.rows_imported, table: result.table });
      setStep("done");
      onImported();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal mengimpor data");
      setStep("configure");
    }
  }

  const includedCount = columns.filter((c) => c.include).length;
  const canImport =
    targetTable.trim().length > 0 &&
    includedCount > 0 &&
    columns.filter((c) => c.include).every((c) => c.target_name.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-3xl p-6 relative max-h-[90vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-faint hover:text-text transition-colors"
        >
          <X size={18} />
        </button>
        <h2 className="font-display text-lg text-text mb-1 flex items-center gap-2">
          <FileSpreadsheet size={18} className="text-cyan" />
          Import dari Excel
        </h2>
        <p className="text-sm text-text-muted mb-5">
          Buat tabel baru atau tambahkan data ke tabel yang sudah ada dari file .xlsx/.xlsm.
        </p>

        <div className="overflow-y-auto dbx-scrollbar pr-1 flex-1 space-y-4">
          {step === "pick_file" && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="dbx-glass rounded-lg p-10 flex flex-col items-center justify-center gap-2 cursor-pointer border-2 border-dashed border-border-glass-strong hover:border-cyan/40 transition-colors"
            >
              <Upload size={28} className="text-text-faint" />
              <p className="text-sm text-text-muted">Klik untuk pilih file .xlsx / .xlsm</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileChosen(f);
                }}
              />
            </div>
          )}

          {analyzing && (
            <div className="flex items-center justify-center gap-2 text-sm text-text-muted py-10">
              <Loader2 size={16} className="animate-spin" />
              Membaca file...
            </div>
          )}

          {step === "configure" && analysis && (
            <>
              {analysis.sheets.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">Sheet</label>
                  <select
                    value={selectedSheet}
                    onChange={(e) => {
                      setSelectedSheet(e.target.value);
                      if (file) void runAnalyze(file, e.target.value, headerRow);
                    }}
                    className="dbx-input"
                  >
                    {analysis.sheets.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">Baris Header</label>
                  <input
                    type="number"
                    min={1}
                    value={headerRow}
                    onChange={(e) => {
                      const v = Math.max(1, Number(e.target.value) || 1);
                      setHeaderRow(v);
                      if (file) void runAnalyze(file, selectedSheet, v);
                    }}
                    className="dbx-input w-20"
                  />
                </div>
                <p className="text-xs text-text-faint mt-5">
                  {analysis.row_count.toLocaleString("id-ID")} baris data terdeteksi
                  {analysis.row_count_exceeds_limit && (
                    <span className="text-danger"> — melebihi batas import</span>
                  )}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">Tujuan</label>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={() => setMode("create")}
                    className={`flex-1 text-xs rounded-lg px-3 py-2 border transition-colors ${
                      mode === "create"
                        ? "border-cyan/50 bg-cyan/10 text-cyan"
                        : "border-border-glass text-text-muted hover:border-border-glass-strong"
                    }`}
                  >
                    Buat tabel baru
                  </button>
                  <button
                    onClick={() => setMode("append")}
                    className={`flex-1 text-xs rounded-lg px-3 py-2 border transition-colors ${
                      mode === "append"
                        ? "border-cyan/50 bg-cyan/10 text-cyan"
                        : "border-border-glass text-text-muted hover:border-border-glass-strong"
                    }`}
                  >
                    Tambahkan ke tabel yang ada
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    value={targetSchema}
                    onChange={(e) => setTargetSchema(e.target.value)}
                    placeholder="schema"
                    className="dbx-input w-32 text-xs font-mono"
                  />
                  {mode === "create" ? (
                    <input
                      value={targetTable}
                      onChange={(e) => setTargetTable(e.target.value)}
                      placeholder="nama_tabel_baru"
                      className="dbx-input flex-1 text-xs font-mono"
                    />
                  ) : (
                    <select
                      value={targetTable}
                      onChange={(e) => setTargetTable(e.target.value)}
                      className="dbx-input flex-1 text-xs font-mono"
                    >
                      <option value="">-- pilih tabel --</option>
                      {existingTables.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {mode === "append" && (
                  <p className="text-[11px] text-text-faint mt-1.5">
                    Samakan &quot;Kolom Tujuan&quot; di bawah dengan nama kolom pada tabel tersebut.
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-text-muted">
                    Kolom ({includedCount}/{columns.length} disertakan)
                  </label>
                </div>
                <div className="space-y-1.5">
                  {columns.map((c, i) => (
                    <div
                      key={c.index}
                      className={`dbx-glass rounded-lg p-2.5 flex items-center gap-2 ${
                        !c.include ? "opacity-40" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={c.include}
                        onChange={(e) => updateColumn(i, { include: e.target.checked })}
                        title="Sertakan kolom ini"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-text-faint truncate">{c.source_name}</p>
                        <input
                          value={c.target_name}
                          onChange={(e) => updateColumn(i, { target_name: e.target.value })}
                          disabled={!c.include}
                          className="dbx-input text-xs font-mono py-1"
                        />
                      </div>
                      {mode === "create" && (
                        <select
                          value={c.type}
                          onChange={(e) => updateColumn(i, { type: e.target.value })}
                          disabled={!c.include}
                          className="dbx-input w-36 shrink-0 text-xs"
                        >
                          {COMMON_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {analysis.preview_rows.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">
                    Contoh Data
                  </label>
                  <div className="dbx-glass rounded-lg overflow-x-auto dbx-scrollbar">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="border-b border-border-glass">
                          {columns
                            .filter((c) => c.include)
                            .map((c) => (
                              <th
                                key={c.index}
                                className="text-left px-2.5 py-1.5 text-text-faint font-mono whitespace-nowrap"
                              >
                                {c.target_name}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.preview_rows.slice(0, 5).map((row, ri) => (
                          <tr key={ri} className="border-b border-border-glass/50 last:border-0">
                            {columns
                              .filter((c) => c.include)
                              .map((c) => (
                                <td key={c.index} className="px-2.5 py-1.5 text-text whitespace-nowrap">
                                  {row[c.index] === null || row[c.index] === undefined
                                    ? <span className="text-text-faint">NULL</span>
                                    : String(row[c.index])}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  setFile(null);
                  setAnalysis(null);
                  setStep("pick_file");
                }}
                className="flex items-center gap-1.5 text-xs text-text-faint hover:text-danger transition-colors"
              >
                <Trash2 size={12} /> Ganti file
              </button>
            </>
          )}

          {step === "importing" && (
            <div className="flex items-center justify-center gap-2 text-sm text-text-muted py-16">
              <Loader2 size={16} className="animate-spin" />
              Mengimpor data...
            </div>
          )}

          {step === "done" && importResult && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <CheckCircle2 size={32} className="text-cyan" />
              <p className="text-sm text-text">
                {importResult.rows_imported.toLocaleString("id-ID")} baris berhasil diimpor ke{" "}
                <span className="font-mono text-cyan">{importResult.table}</span>
              </p>
            </div>
          )}

          {error && (
            <div className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {step === "configure" && (
          <button
            onClick={handleImport}
            disabled={!canImport}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 mt-4 hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
          >
            <Upload size={14} />
            Import {includedCount} kolom
          </button>
        )}
        {step === "done" && (
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 mt-4 hover:opacity-90 transition-opacity shrink-0"
          >
            Selesai
          </button>
        )}
      </div>
    </div>
  );
}
