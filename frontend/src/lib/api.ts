/**
 * Thin typed client over the DEXAZ FastAPI backend.
 * Base URL comes from NEXT_PUBLIC_API_URL (defaults to the local backend).
 * Auth token is read from localStorage — this is a real Next.js app the
 * user runs on their own machine, not a hosted/shared artifact.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("dbx_token");
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* no json body */
    }

    // Session expired or invalid: clear it and send the user back to
    // login instead of letting every call site handle this individually
    // (an unhandled 401 was surfacing as a full-page dev-mode crash).
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/login")) {
      localStorage.removeItem("dbx_token");
      localStorage.removeItem("dbx_username");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Like request(), but for multipart/form-data uploads (Excel import) — no
 * Content-Type header is set manually so the browser can add the correct
 * multipart boundary itself.
 */
async function multipartRequest<T>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: form });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* no json body */
    }
    if (res.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("dbx_token");
      localStorage.removeItem("dbx_username");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    throw new ApiError(detail, res.status);
  }
  return res.json();
}

// --- Types ---
export interface Connection {
  id: string;
  name: string;
  db_type: string;
  host?: string;
  port?: number;
  database_name?: string;
  username?: string;
  ssl_mode?: string;
  sqlite_path?: string;
  is_favorite: boolean;
  status?: string | null;
}

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_sqlite_file: boolean;
}

export interface FsRootsResult {
  roots: FsEntry[];
  default_path: string;
}

export interface FsBrowseResult {
  current_path: string;
  parent_path: string | null;
  entries: FsEntry[];
}

export interface AppDocument {
  id: string;
  filename: string;
  file_type: "pdf" | "ppt" | "pptx";
  size_bytes: number;
  uploaded_at: string | null;
}

export interface SchemaNode {
  schema: string;
  tables: { name: string; size?: string; comment?: string | null; approx_row_count?: number }[];
  views: { name: string; definition?: string }[];
  functions: { name: string }[];
  sequences: { name: string }[];
}

export interface SchemaTree {
  schemas: SchemaNode[];
}

export interface TableData {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardSummary {
  connections: number;
  tables: number;
  views: number;
  queries_run: number;
  saved_queries: number;
}

// --- Excel import ---
export interface ExcelImportColumn {
  index: number;
  source_name: string;
  target_name: string;
  type: string;
  include: boolean;
}

export interface ExcelAnalyzeResult {
  sheets: string[];
  active_sheet: string;
  header_row: number;
  columns: ExcelImportColumn[];
  preview_rows: (string | number | boolean | null)[][];
  row_count: number;
  row_count_exceeds_limit?: boolean;
}

export interface ExcelImportExecuteResult {
  success: boolean;
  rows_imported: number;
  table: string;
  created_table: boolean;
}

// --- Table/query summary (Dashboard) ---
export interface ColumnProfile {
  column: string;
  null_count: number;
  null_pct: number;
  distinct_count: number;
  kind: "numeric" | "temporal" | "text";
  min?: number | string;
  max?: number | string;
  avg?: number;
  top_values?: { value: string; count: number }[];
}

export interface TableSummaryResult {
  source: string;
  columns: string[];
  column_profiles: ColumnProfile[];
  total_rows: number;
  sampled_rows: number;
  is_sampled: boolean;
}

// --- Dashboard report (charts / totals) ---
export interface ReportColumnTotal {
  column: string;
  sum: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
}

export interface ReportTotalsResult {
  source: string;
  mode: "totals";
  row_count: number;
  totals: ReportColumnTotal[];
}

export interface ReportGroupedResult {
  source: string;
  mode: "grouped";
  group_by: string;
  value_column: string | null;
  agg: "sum" | "avg" | "count" | "min" | "max";
  labels: string[];
  values: number[];
  grand_total: number | null;
  truncated: boolean;
}

export interface ColumnValuesResult {
  source: string;
  column: string;
  values: { value: string; count: number }[];
  total_distinct: number | null;
  truncated: boolean;
}

export interface SavedQueryItem {
  id: string;
  connection_id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  sql: string;
  tags: string[];
  created_at: string;
}

export interface QueryHistoryItem {
  id: string;
  connection_id: string;
  sql: string;
  status: "success" | "error";
  error: string | null;
  row_count: number;
  duration_ms: number;
  executed_at: string;
}

export interface QueryExecuteResult {
  success: boolean;
  statement_type: string;
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  duration_ms: number;
  error: string | null;
  requires_confirmation: boolean;
  warning: string | null;
}

export interface ErdColumn {
  name: string;
  type: string;
  nullable: boolean;
  is_primary_key: boolean;
  is_unique: boolean;
}
export interface ErdForeignKey {
  constraint_name: string;
  column: string;
  referenced_table: string;
  referenced_column: string;
  relationship: "one-to-one" | "one-to-many";
}
export interface ErdTable {
  name: string;
  columns: ErdColumn[];
  primary_keys: string[];
  foreign_keys: ErdForeignKey[];
}
export interface ErdData {
  schema: string;
  tables: ErdTable[];
}

/**
 * A table reachable from `tableName` via one FK hop (either direction):
 * outgoing (tableName has the FK column) or incoming (the other table's
 * FK column points back at tableName). Used to offer that table's columns
 * as extra filter options in Query Builder, and to know how to JOIN it.
 */
export interface RelatedTable {
  table: string;
  /** Column on the primary table (`tableName`) used in the join condition. */
  localColumn: string;
  /** Column on this related table used in the join condition. */
  foreignColumn: string;
  columns: string[];
}

export function getRelatedTables(erd: ErdData, tableName: string): RelatedTable[] {
  const byTable = new Map<string, RelatedTable>();
  const primary = erd.tables.find((t) => t.name === tableName);
  if (!primary) return [];

  // Outgoing: this table has an FK column pointing at another table's PK/unique column.
  for (const fk of primary.foreign_keys) {
    if (fk.referenced_table === tableName) continue;
    const target = erd.tables.find((t) => t.name === fk.referenced_table);
    if (!target || byTable.has(target.name)) continue;
    byTable.set(target.name, {
      table: target.name,
      localColumn: fk.column,
      foreignColumn: fk.referenced_column,
      columns: target.columns.map((c) => c.name),
    });
  }

  // Incoming: another table has an FK column pointing back at this table.
  for (const t of erd.tables) {
    if (t.name === tableName || byTable.has(t.name)) continue;
    const fk = t.foreign_keys.find((f) => f.referenced_table === tableName);
    if (!fk) continue;
    byTable.set(t.name, {
      table: t.name,
      localColumn: fk.referenced_column,
      foreignColumn: fk.column,
      columns: t.columns.map((c) => c.name),
    });
  }

  return [...byTable.values()];
}

// --- API ---
export const api = {
  login: (username: string, password: string) =>
    request<{ access_token: string; username: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  me: () => request<{ id: string; username: string; role: string }>("/api/auth/me"),

  listConnections: () => request<Connection[]>("/api/databases"),

  fsRoots: () => request<FsRootsResult>("/api/fs/roots"),

  fsBrowse: (path?: string) => {
    const params = path ? `?path=${encodeURIComponent(path)}` : "";
    return request<FsBrowseResult>(`/api/fs/browse${params}`);
  },

  createConnection: (payload: Partial<Connection> & { password?: string }) =>
    request<Connection>("/api/databases", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateConnection: (id: string, payload: Record<string, unknown>) =>
    request<Connection>(`/api/databases/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteConnection: (id: string) =>
    request<{ success: boolean }>(`/api/databases/${id}`, { method: "DELETE" }),

  testConnection: (id: string) =>
    request<{ success: boolean; message: string; server_version?: string }>(
      `/api/databases/${id}/test`,
      { method: "POST" }
    ),

  refreshMetadata: (id: string, database?: string) =>
    request<SchemaTree>(
      `/api/databases/${id}/refresh${database ? `?database=${encodeURIComponent(database)}` : ""}`,
      { method: "POST" }
    ),

  getSchemas: (id: string, database?: string) =>
    request<SchemaTree>(
      `/api/databases/${id}/schemas${database ? `?database=${encodeURIComponent(database)}` : ""}`
    ),

  listDatabases: (id: string) =>
    request<{ name: string; size: string | null }[]>(`/api/databases/${id}/databases`),

  getTableData: (
    connectionId: string,
    schema: string,
    table: string,
    page = 1,
    limit = 100,
    sortColumn?: string,
    sortDir: "asc" | "desc" = "asc",
    filters?: { column: string; op: string; value: string }[],
    database?: string
  ) => {
    const params = new URLSearchParams({
      schema,
      page: String(page),
      limit: String(limit),
      sort_dir: sortDir,
    });
    if (sortColumn) params.set("sort_column", sortColumn);
    if (filters && filters.length > 0) params.set("filters", JSON.stringify(filters));
    if (database) params.set("database", database);
    return request<TableData>(
      `/api/databases/${connectionId}/tables/${table}/data?${params.toString()}`
    );
  },

  getTableStructure: (connectionId: string, schema: string, table: string, database?: string) =>
    request<{
      columns: {
        name: string;
        type: string;
        nullable: boolean;
        default_value: string | null;
        max_length: number | null;
        comment: string | null;
      }[];
      primary_keys: { column_name: string; constraint_name: string }[];
      constraints: { constraint_name: string; constraint_type: string }[];
    }>(
      `/api/databases/${connectionId}/tables/${table}/structure?schema=${schema}${
        database ? `&database=${encodeURIComponent(database)}` : ""
      }`
    ),

  getTableRelations: (connectionId: string, schema: string, table: string, database?: string) =>
    request<{
      foreign_keys: {
        constraint_name: string;
        column_name: string;
        referenced_schema: string;
        referenced_table: string;
        referenced_column: string;
      }[];
    }>(
      `/api/databases/${connectionId}/tables/${table}/relations?schema=${schema}${
        database ? `&database=${encodeURIComponent(database)}` : ""
      }`
    ),

  getTableIndexes: (connectionId: string, schema: string, table: string, database?: string) =>
    request<
      { index_name: string; is_unique: boolean; is_primary: boolean; columns: string; size?: string }[]
    >(
      `/api/databases/${connectionId}/tables/${table}/indexes?schema=${schema}${
        database ? `&database=${encodeURIComponent(database)}` : ""
      }`
    ),

  dashboardSummary: () => request<DashboardSummary>("/api/dashboard/summary"),

  executeQuery: (connectionId: string, sql: string, confirmDestructive = false, database?: string) =>
    request<QueryExecuteResult>("/api/query/execute", {
      method: "POST",
      body: JSON.stringify({
        connection_id: connectionId,
        sql,
        confirm_destructive: confirmDestructive,
        database,
      }),
    }),

  getQueryHistory: (connectionId?: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (connectionId) params.set("connection_id", connectionId);
    return request<QueryHistoryItem[]>(`/api/query/history?${params.toString()}`);
  },

  deleteHistoryEntry: (id: string) =>
    request<{ success: boolean }>(`/api/query/history/${id}`, { method: "DELETE" }),

  listSavedQueries: (connectionId?: string) => {
    const params = connectionId ? `?connection_id=${connectionId}` : "";
    return request<SavedQueryItem[]>(`/api/queries${params}`);
  },

  createSavedQuery: (payload: {
    connection_id?: string;
    name: string;
    description?: string;
    category?: string;
    sql: string;
    tags?: string[];
  }) =>
    request<SavedQueryItem>("/api/queries", { method: "POST", body: JSON.stringify(payload) }),

  updateSavedQuery: (id: string, payload: Record<string, unknown>) =>
    request<SavedQueryItem>(`/api/queries/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteSavedQuery: (id: string) =>
    request<{ success: boolean }>(`/api/queries/${id}`, { method: "DELETE" }),

  insertRow: (
    connectionId: string,
    schema: string,
    table: string,
    values: Record<string, unknown>,
    database?: string
  ) =>
    request<{ success: boolean; row: Record<string, unknown> | null }>(
      `/api/databases/${connectionId}/tables/${table}/rows?schema=${schema}${
        database ? `&database=${encodeURIComponent(database)}` : ""
      }`,
      { method: "POST", body: JSON.stringify({ values }) }
    ),

  updateRow: (
    connectionId: string,
    schema: string,
    table: string,
    pk: Record<string, unknown>,
    values: Record<string, unknown>,
    database?: string
  ) =>
    request<{ success: boolean; row: Record<string, unknown> | null }>(
      `/api/databases/${connectionId}/tables/${table}/rows?schema=${schema}${
        database ? `&database=${encodeURIComponent(database)}` : ""
      }`,
      { method: "PUT", body: JSON.stringify({ pk, values }) }
    ),

  deleteRow: (
    connectionId: string,
    schema: string,
    table: string,
    pk: Record<string, unknown>,
    database?: string
  ) =>
    request<{ success: boolean; deleted: number }>(
      `/api/databases/${connectionId}/tables/${table}/rows?schema=${schema}${
        database ? `&database=${encodeURIComponent(database)}` : ""
      }`,
      { method: "DELETE", body: JSON.stringify({ pk }) }
    ),

  getErd: (connectionId: string, schema: string, database?: string) =>
    request<ErdData>(
      `/api/databases/${connectionId}/erd?schema=${schema}${
        database ? `&database=${encodeURIComponent(database)}` : ""
      }`
    ),

  createRelationship: (
    connectionId: string,
    schema: string,
    table: string,
    column: string,
    refTable: string,
    refColumn: string,
    database?: string
  ) =>
    request<{ success: boolean; constraint_name: string }>(
      `/api/databases/${connectionId}/erd/relationships`,
      {
        method: "POST",
        body: JSON.stringify({
          schema_name: schema,
          table,
          column,
          ref_table: refTable,
          ref_column: refColumn,
          database,
        }),
      }
    ),

  deleteRelationship: (
    connectionId: string,
    schema: string,
    table: string,
    constraintName: string,
    database?: string
  ) =>
    request<{ success: boolean }>(`/api/databases/${connectionId}/erd/relationships/delete`, {
      method: "POST",
      body: JSON.stringify({ schema_name: schema, table, constraint_name: constraintName, database }),
    }),

  dashboardTableSummary: (payload: {
    connectionId: string;
    schema?: string;
    table?: string;
    savedQueryId?: string;
    sql?: string;
  }) =>
    request<TableSummaryResult>("/api/dashboard/table-summary", {
      method: "POST",
      body: JSON.stringify({
        connection_id: payload.connectionId,
        schema: payload.schema,
        table: payload.table,
        saved_query_id: payload.savedQueryId,
        sql: payload.sql,
      }),
    }),

  dashboardReportTotals: (payload: {
    connectionId: string;
    schema?: string;
    table?: string;
    savedQueryId?: string;
    sql?: string;
    columns: string[];
  }) =>
    request<ReportTotalsResult>("/api/dashboard/report", {
      method: "POST",
      body: JSON.stringify({
        connection_id: payload.connectionId,
        schema: payload.schema,
        table: payload.table,
        saved_query_id: payload.savedQueryId,
        sql: payload.sql,
        mode: "totals",
        columns: payload.columns,
      }),
    }),

  dashboardReportGrouped: (payload: {
    connectionId: string;
    schema?: string;
    table?: string;
    savedQueryId?: string;
    sql?: string;
    groupBy: string;
    valueColumn?: string;
    agg: "sum" | "avg" | "count" | "min" | "max";
    limit?: number;
    all?: boolean;
    sort?: "value_desc" | "value_asc" | "label_asc" | "label_desc";
  }) =>
    request<ReportGroupedResult>("/api/dashboard/report", {
      method: "POST",
      body: JSON.stringify({
        connection_id: payload.connectionId,
        schema: payload.schema,
        table: payload.table,
        saved_query_id: payload.savedQueryId,
        sql: payload.sql,
        mode: "grouped",
        group_by: payload.groupBy,
        value_column: payload.valueColumn,
        agg: payload.agg,
        limit: payload.limit,
        all: payload.all,
        sort: payload.sort,
      }),
    }),

  dashboardColumnValues: (payload: {
    connectionId: string;
    schema?: string;
    table?: string;
    savedQueryId?: string;
    sql?: string;
    column: string;
    limit?: number;
  }) =>
    request<ColumnValuesResult>("/api/dashboard/column-values", {
      method: "POST",
      body: JSON.stringify({
        connection_id: payload.connectionId,
        schema: payload.schema,
        table: payload.table,
        saved_query_id: payload.savedQueryId,
        sql: payload.sql,
        column: payload.column,
        limit: payload.limit,
      }),
    }),

  analyzeExcelImport: (connectionId: string, file: File, sheet?: string, headerRow = 1) => {
    const form = new FormData();
    form.append("file", file);
    if (sheet) form.append("sheet", sheet);
    form.append("header_row", String(headerRow));
    return multipartRequest<ExcelAnalyzeResult>(`/api/import/${connectionId}/analyze`, form);
  },

  executeExcelImport: (
    connectionId: string,
    file: File,
    config: {
      sheet: string;
      header_row: number;
      schema: string;
      table: string;
      mode: "create" | "append";
      columns: ExcelImportColumn[];
      database?: string;
    }
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("config", JSON.stringify(config));
    return multipartRequest<ExcelImportExecuteResult>(`/api/import/${connectionId}/execute`, form);
  },

  listDocuments: () => request<AppDocument[]>("/api/documents"),

  uploadDocument: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return multipartRequest<AppDocument>("/api/documents/upload", form);
  },

  deleteDocument: (id: string) => request<{ status: string }>(`/api/documents/${id}`, { method: "DELETE" }),
};

// Fetches a document's raw bytes as an ArrayBuffer, with the auth header
// attached manually (a plain <img>/<iframe> src can't send Authorization,
// and the viewer libraries — react-pdf, pptx-preview — both want an
// ArrayBuffer/Blob directly rather than a URL anyway).
export async function fetchDocumentBytes(id: string): Promise<ArrayBuffer> {
  const token = typeof window !== "undefined" ? localStorage.getItem("dbx_token") : null;
  const res = await fetch(`${API_BASE}/api/documents/${id}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status);
  }
  return res.arrayBuffer();
}

// --- Export (returns a raw Blob + suggested filename, not JSON) ---
function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = header.match(/filename="?([^"]+)"?/);
  return match ? match[1] : fallback;
}

async function exportRequest(
  path: string,
  body: Record<string, unknown>
): Promise<{ blob: Blob; filename: string }> {
  const token = typeof window !== "undefined" ? localStorage.getItem("dbx_token") : null;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const json = await res.json();
      detail = json.detail || detail;
    } catch {
      /* no json body */
    }
    throw new ApiError(detail, res.status);
  }
  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), "export");
  return { blob, filename };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const exportApi = {
  exportQuery: (connectionId: string, sql: string, format: "csv" | "json" | "excel") =>
    exportRequest("/api/export/query", { connection_id: connectionId, sql, format }),

  exportTable: (params: {
    connectionId: string;
    schema: string;
    table: string;
    format: "csv" | "json" | "excel";
    scope: "current_page" | "filtered" | "all";
    page?: number;
    limit?: number;
    sortColumn?: string;
    sortDir?: "asc" | "desc";
    filters?: { column: string; op: string; value: string }[];
    database?: string;
  }) =>
    exportRequest("/api/export/table", {
      connection_id: params.connectionId,
      schema: params.schema,
      table: params.table,
      format: params.format,
      scope: params.scope,
      page: params.page,
      limit: params.limit,
      sort_column: params.sortColumn,
      sort_dir: params.sortDir,
      filters: params.filters,
      database: params.database,
    }),
};

// --- Pure client-side export (no backend round trip) for data already loaded ---
export function exportRowsClientSide(
  columns: string[],
  rows: Record<string, unknown>[],
  format: "csv" | "json",
  filenameBase: string
) {
  if (format === "json") {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${filenameBase}.json`);
    return;
  }
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => escape(r[c])).join(","))];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${filenameBase}.csv`);
}
