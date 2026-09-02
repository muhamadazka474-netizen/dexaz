# DEXAZ (Database Explorer Azka) — Architecture (Phase 1)

## 1. High-Level Architecture

```
Browser (you)
     │
     ▼
DEXAZ Frontend  (Next.js, http://127.0.0.1:3000)
     │  REST/JSON, Bearer JWT
     ▼
DEXAZ Backend   (FastAPI, http://127.0.0.1:8000)
     │
     ├── Internal DB (SQLite) ── users, connections, saved queries,
     │                            query history, audit log
     │
     └── DatabaseAdapter ──────► Target database (your local PostgreSQL)
```

Both frontend and backend bind to `127.0.0.1` by default — nothing is
reachable from the network unless you deliberately change `DBX_HOST` /
`DBX_FRONTEND_ORIGIN`. No feature in Phase 1 requires internet access.

## 2. Detailed Architecture

- **Frontend** (`frontend/`): Next.js App Router + TypeScript + Tailwind
  v4. Talks to the backend only through `src/lib/api.ts`, a typed
  fetch client. Auth state lives in `src/lib/auth-context.tsx` and the
  JWT is kept in `localStorage`.
- **Backend** (`backend/`): FastAPI app (`main.py`) that wires together
  routers under `app/api/`. Business logic is split by concern:
  `app/adapters` (talks to target DBs), `app/schema` (introspection
  caching), `app/query` (SQL safety checks), `app/audit` (audit log),
  `app/auth` (JWT dependency), `app/core` (config + security helpers).
- **Internal database**: SQLite file (`dbxplorer_internal.db`),
  completely separate from any database you connect to. Holds
  DEXAZ's own operational data only.
- **Target database**: whatever PostgreSQL instance you register as a
  "connection" — Phase 1 supports PostgreSQL; the `DatabaseAdapter`
  interface is designed so MySQL/MariaDB/SQLite can be added later
  without touching the API layer.

## 3. Folder Structure

```
dbxplorer/
├── backend/
│   ├── app/
│   │   ├── api/            # auth, connections, tables, query, dashboard routers
│   │   ├── adapters/        # DatabaseAdapter interface + PostgresAdapter + factory
│   │   ├── auth/             # JWT dependency (get_current_user)
│   │   ├── audit/            # audit log writer
│   │   ├── core/              # settings (.env) + security (hash/JWT/Fernet)
│   │   ├── database/          # internal SQLAlchemy session/engine
│   │   ├── models/             # internal.py (ORM) + api_schemas.py (Pydantic)
│   │   ├── query/               # SQL destructive-statement safety check
│   │   └── schema/               # introspection engine + cache
│   ├── main.py                    # app entrypoint, startup seeding
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── app/                    # login, dashboard, connections, explorer
│       ├── components/              # AppShell, DatabaseExplorerTree, TableViewer, DynamicDataGrid, AddConnectionModal, ui.tsx
│       └── lib/                      # api.ts (client), auth-context.tsx
├── .env                                # your real local secrets (gitignored)
├── .env.example
└── README.md
```

## 4. Database Schema (internal app DB)

| Table                 | Purpose                                             |
|-----------------------|------------------------------------------------------|
| `users`                | Local login accounts (seeded admin on first run)     |
| `database_connections` | Saved connections; password stored Fernet-encrypted  |
| `saved_queries`         | User-saved SQL (Phase 6+)                           |
| `query_history`          | Every query run, with duration/row count/status     |
| `audit_logs`              | LOGIN/CONNECT/QUERY/CREATE/ALTER/DROP/... trail     |

None of this is your data — it's DEXAZ's own bookkeeping.

## 5. API Architecture

```
POST   /api/auth/login                                   → JWT
GET    /api/auth/me

GET    /api/databases                                      list connections
POST   /api/databases                                        create
PUT    /api/databases/{id}
DELETE /api/databases/{id}
POST   /api/databases/{id}/test                                test_connection()
POST   /api/databases/{id}/refresh                               force re-introspect
GET    /api/databases/{id}/schemas                                 full schema/table/view tree

GET    /api/databases/{id}/tables?schema=...
GET    /api/databases/{id}/tables/{table}/data?schema=&page=&limit=
GET    /api/databases/{id}/tables/{table}/structure?schema=
GET    /api/databases/{id}/tables/{table}/relations?schema=
GET    /api/databases/{id}/tables/{table}/indexes?schema=

POST   /api/query/execute            { connection_id, sql, confirm_destructive }
GET    /api/query/history
DELETE /api/query/history/{id}

GET    /api/dashboard/summary
```

Every route except `/api/auth/login` and `/api/health` requires
`Authorization: Bearer <token>`.

## 6. Database Adapter Architecture

`app/adapters/base.py` defines `DatabaseAdapter`, an abstract class
with methods like `get_schemas()`, `get_columns()`, `execute_query()`,
`insert_row()`, `create_table()`, etc. `app/adapters/postgres_adapter.py`
implements it for PostgreSQL using `information_schema` / `pg_catalog`
introspection — **nothing is hard-coded**: no table/column/schema name
appears anywhere in the adapter or the routes. `app/adapters/factory.py`
picks the right adapter class from a connection's `db_type`. Adding
MySQL later means: write `mysql_adapter.py` implementing the same
interface, add one branch in the factory — nothing else changes.

## 7. Frontend Component Architecture

- `AppShell` — sidebar nav + top bar, wraps every authenticated page.
- `DatabaseExplorerTree` — fully generic tree; renders whatever
  `schemas[].tables[]/views[]` the API returns.
- `TableViewer` — tabs for Data / Structure / Relations / Indexes,
  each tab is its own small component fetching its own endpoint.
- `DynamicDataGrid` — generic grid driven entirely by `columns[]` +
  `rows[]`; never references a specific table's shape.
- `AddConnectionModal` — connection form with inline Test Connection.

## 8. Security Architecture

- Passwords for DEXAZ's own users: bcrypt via `passlib`.
- Session: JWT (HS256), secret from `.env` (`JWT_SECRET`), 8h expiry.
- Target-database passwords: encrypted at rest with Fernet
  (`ENCRYPTION_KEY` in `.env`), decrypted only in-memory right before
  connecting, never returned to the frontend.
- CORS locked to `DBX_FRONTEND_ORIGIN` (default `127.0.0.1:3000`).
- Destructive SQL (`DELETE`/`UPDATE` without `WHERE`, `DROP`,
  `TRUNCATE`) requires an explicit `confirm_destructive: true` from
  the client — the backend refuses to run it otherwise.
- `statement_timeout` is set per-query from `DBX_QUERY_TIMEOUT_SECONDS`;
  result rows are capped at `DBX_MAX_ROWS_RETURNED`.

## 9. Data Flow (example: viewing table data)

```
Explorer page
  → GET /api/databases/{id}/schemas   (cached 60s server-side)
  → user clicks a table
  → GET /api/databases/{id}/tables/{table}/data?schema=...&page=1
      → connections router resolves the DatabaseConnection row
      → adapters/factory builds a PostgresAdapter (password decrypted)
      → adapter.get_table_data() runs a parameterized, LIMIT/OFFSET query
      → JSON {columns, rows, total} returned
  → DynamicDataGrid renders it, no column assumptions baked in
```

## 10. Development Roadmap

- **Phase 1 (this delivery)** — connection manager, introspection
  engine, dynamic explorer, table data/structure/relations/indexes
  viewer, dashboard, auth, audit log, query execution API with safety
  confirmation (UI for the SQL Editor itself is Phase 3).
- **Phase 2** — richer data grid (inline sort/filter UI, column
  resize/reorder/visibility, fullscreen).
- **Phase 3** — SQL Editor (Monaco), autocomplete, multi-tab, saved
  query UI, query history UI.
- **Phase 4** — CRUD forms, Table Designer (create/alter/drop with SQL
  preview) — adapter methods already exist, need UI.
- **Phase 5** — Export to Excel/CSV/JSON.
- **Phase 6** — SQL Library.
- **Phase 7** — visual Query Builder.
- **Phase 8** — ERD view, EXPLAIN, Command Palette, global search,
  favorites.
- **Phase 9** — hardening: rate limiting, finer-grained authorization.
- **Phase 10** — Docker packaging, docs, tests, production build.
