"use client";

import { useMemo, useState } from "react";
import { DynamicDataGrid } from "./DynamicDataGrid";
import { exportRowsClientSide, exportApi, downloadBlob } from "@/lib/api";

export function QueryResultGrid({
  columns,
  rows,
  loading,
  connectionId,
  sql,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  loading?: boolean;
  connectionId?: string;
  sql?: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortColumn, setSortColumn] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [exporting, setExporting] = useState(false);

  const sortedRows = useMemo(() => {
    if (!sortColumn) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortColumn];
      const bv = b[sortColumn];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av > bv ? 1 : -1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortColumn, sortDir]);

  const pageRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  function handleExport(format: "csv" | "json" | "excel") {
    if (format !== "excel") {
      exportRowsClientSide(columns, rows, format, "query_result");
      return;
    }
    if (!connectionId || !sql) return;
    setExporting(true);
    exportApi
      .exportQuery(connectionId, sql, "excel")
      .then(({ blob, filename }) => downloadBlob(blob, filename))
      .finally(() => setExporting(false));
  }

  return (
    <DynamicDataGrid
      columns={columns}
      rows={pageRows}
      total={rows.length}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(s) => {
        setPageSize(s);
        setPage(1);
      }}
      loading={loading}
      sortColumn={sortColumn}
      sortDir={sortDir}
      onSortChange={(col, dir) => {
        setSortColumn(dir ? col : undefined);
        setSortDir(dir ?? "asc");
        setPage(1);
      }}
      onExportCurrent={handleExport}
      exporting={exporting}
    />
  );
}
