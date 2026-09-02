"""
PostgreSQL adapter — Phase 1 priority implementation of DatabaseAdapter.

All structural information (databases, schemas, tables, columns, keys,
indexes, constraints, views, functions, sequences) comes from
information_schema / pg_catalog introspection. Nothing here references
a specific database/schema/table/column name.
"""
import time
from contextlib import contextmanager
from typing import Any, Optional

import psycopg2
import psycopg2.extras
from psycopg2 import sql as pgsql

from app.adapters.base import DatabaseAdapter

# Statement types considered destructive / requiring confirmation on the client.
WRITE_KEYWORDS = ("INSERT", "UPDATE", "DELETE")
DDL_KEYWORDS = ("CREATE", "ALTER", "DROP", "TRUNCATE")


class PostgresAdapter(DatabaseAdapter):
    db_type = "postgresql"

    def __init__(self, host: str, port: int, database: str, username: str,
                 password: str, ssl_mode: str = "prefer"):
        self.host = host
        self.port = port
        self.database = database
        self.username = username
        self.password = password
        self.ssl_mode = ssl_mode or "prefer"
        self._conn = None

    # ------------------------------------------------------------------
    # connection lifecycle
    # ------------------------------------------------------------------
    def connect(self) -> None:
        self._conn = psycopg2.connect(
            host=self.host,
            port=self.port,
            dbname=self.database,
            user=self.username,
            password=self.password,
            sslmode=self.ssl_mode,
            connect_timeout=10,
        )
        self._conn.autocommit = False

    def disconnect(self) -> None:
        if self._conn and not self._conn.closed:
            self._conn.close()
        self._conn = None

    def test_connection(self) -> dict[str, Any]:
        try:
            self.connect()
            with self._conn.cursor() as cur:
                cur.execute("SELECT version();")
                version = cur.fetchone()[0]
            return {"success": True, "message": "Connected", "server_version": version}
        except Exception as e:
            return {"success": False, "message": str(e)}
        finally:
            self.disconnect()

    @contextmanager
    def _cursor(self, dict_cursor: bool = True):
        opened_here = False
        if self._conn is None or self._conn.closed:
            self.connect()
            opened_here = True
        cursor_factory = psycopg2.extras.RealDictCursor if dict_cursor else None
        cur = self._conn.cursor(cursor_factory=cursor_factory)
        try:
            yield cur
        finally:
            cur.close()
            if opened_here:
                self.disconnect()

    # ------------------------------------------------------------------
    # introspection
    # ------------------------------------------------------------------
    def get_databases(self) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT datname AS name,
                       pg_size_pretty(pg_database_size(datname)) AS size
                FROM pg_database
                WHERE datistemplate = false
                ORDER BY datname;
            """)
            return [dict(r) for r in cur.fetchall()]

    def get_schemas(self) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT schema_name AS name
                FROM information_schema.schemata
                WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
                  AND schema_name NOT LIKE 'pg_toast%'
                  AND schema_name NOT LIKE 'pg_temp%'
                ORDER BY schema_name;
            """)
            return [dict(r) for r in cur.fetchall()]

    def get_tables(self, schema: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT c.relname AS name,
                       pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
                       obj_description(c.oid) AS comment,
                       (SELECT reltuples::bigint FROM pg_class WHERE oid = c.oid) AS approx_row_count
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = %s AND c.relkind = 'r'
                ORDER BY c.relname;
            """, (schema,))
            return [dict(r) for r in cur.fetchall()]

    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT
                    c.column_name AS name,
                    c.data_type AS type,
                    c.character_maximum_length AS max_length,
                    c.numeric_precision AS numeric_precision,
                    c.numeric_scale AS numeric_scale,
                    c.is_nullable = 'YES' AS nullable,
                    c.column_default AS default_value,
                    c.ordinal_position AS position,
                    col_description(
                        (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass::oid,
                        c.ordinal_position
                    ) AS comment
                FROM information_schema.columns c
                WHERE c.table_schema = %s AND c.table_name = %s
                ORDER BY c.ordinal_position;
            """, (schema, table))
            return [dict(r) for r in cur.fetchall()]

    def get_primary_keys(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT kcu.column_name AS column_name, tc.constraint_name AS constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = %s AND tc.table_name = %s
                ORDER BY kcu.ordinal_position;
            """, (schema, table))
            return [dict(r) for r in cur.fetchall()]

    def get_foreign_keys(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT
                    tc.constraint_name,
                    kcu.column_name AS column_name,
                    ccu.table_schema AS referenced_schema,
                    ccu.table_name AS referenced_table,
                    ccu.column_name AS referenced_column
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND tc.table_schema = %s AND tc.table_name = %s;
            """, (schema, table))
            return [dict(r) for r in cur.fetchall()]

    def get_indexes(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT
                    i.relname AS index_name,
                    ix.indisunique AS is_unique,
                    ix.indisprimary AS is_primary,
                    array_to_string(array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)), ', ') AS columns,
                    pg_size_pretty(pg_relation_size(i.oid)) AS size
                FROM pg_class t
                JOIN pg_namespace n ON n.oid = t.relnamespace
                JOIN pg_index ix ON t.oid = ix.indrelid
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
                WHERE n.nspname = %s AND t.relname = %s
                GROUP BY i.relname, ix.indisunique, ix.indisprimary, i.oid
                ORDER BY i.relname;
            """, (schema, table))
            return [dict(r) for r in cur.fetchall()]

    def get_constraints(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT constraint_name, constraint_type
                FROM information_schema.table_constraints
                WHERE table_schema = %s AND table_name = %s
                ORDER BY constraint_type, constraint_name;
            """, (schema, table))
            return [dict(r) for r in cur.fetchall()]

    def get_views(self, schema: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT table_name AS name, view_definition AS definition
                FROM information_schema.views
                WHERE table_schema = %s
                ORDER BY table_name;
            """, (schema,))
            return [dict(r) for r in cur.fetchall()]

    def get_functions(self, schema: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT p.proname AS name,
                       pg_get_function_result(p.oid) AS return_type,
                       pg_get_function_arguments(p.oid) AS arguments
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = %s
                ORDER BY p.proname;
            """, (schema,))
            return [dict(r) for r in cur.fetchall()]

    def get_sequences(self, schema: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT sequence_name AS name, data_type, start_value, increment
                FROM information_schema.sequences
                WHERE sequence_schema = %s
                ORDER BY sequence_name;
            """, (schema,))
            return [dict(r) for r in cur.fetchall()]

    # ------------------------------------------------------------------
    # data
    # ------------------------------------------------------------------
    def get_table_data(
        self, schema: str, table: str, limit: int, offset: int,
        sort_column: Optional[str] = None, sort_dir: str = "asc",
        filters: Optional[list[dict]] = None,
    ) -> dict[str, Any]:
        ident_table = pgsql.Identifier(schema, table)
        query = pgsql.SQL("SELECT * FROM {} ").format(ident_table)
        count_query = pgsql.SQL("SELECT COUNT(*) AS total FROM {} ").format(ident_table)

        where_clause = pgsql.SQL("")
        params: list[Any] = []
        if filters:
            clauses = []
            for f in filters:
                col = f.get("column")
                op = f.get("op", "=")
                val = f.get("value")
                op_map = {
                    "=": "=", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=",
                    "contains": "ILIKE", "starts_with": "ILIKE", "ends_with": "ILIKE",
                }
                sql_op = op_map.get(op, "=")
                if op == "contains":
                    val = f"%{val}%"
                elif op == "starts_with":
                    val = f"{val}%"
                elif op == "ends_with":
                    val = f"%{val}"
                clauses.append(
                    pgsql.SQL("{} {} %s").format(pgsql.Identifier(col), pgsql.SQL(sql_op))
                )
                params.append(val)
            if clauses:
                where_clause = pgsql.SQL(" WHERE ") + pgsql.SQL(" AND ").join(clauses)

        order_clause = pgsql.SQL("")
        if sort_column:
            direction = pgsql.SQL("ASC" if sort_dir.lower() != "desc" else "DESC")
            order_clause = pgsql.SQL(" ORDER BY {} {}").format(pgsql.Identifier(sort_column), direction)

        full_query = query + where_clause + order_clause + pgsql.SQL(" LIMIT %s OFFSET %s")
        full_count = count_query + where_clause

        with self._cursor() as cur:
            cur.execute(full_count, params)
            total = cur.fetchone()["total"]
            cur.execute(full_query, params + [limit, offset])
            rows = [dict(r) for r in cur.fetchall()]
            columns = [desc[0] for desc in cur.description] if cur.description else []

        return {"columns": columns, "rows": rows, "total": total, "limit": limit, "offset": offset}

    # ------------------------------------------------------------------
    # query execution
    # ------------------------------------------------------------------
    def classify_statement(self, sql_text: str) -> str:
        first_word = sql_text.strip().split(None, 1)[0].upper() if sql_text.strip() else ""
        if first_word in WRITE_KEYWORDS:
            return "write"
        if first_word in DDL_KEYWORDS:
            return "ddl"
        if first_word in ("SELECT", "WITH", "EXPLAIN", "SHOW"):
            return "read"
        return "other"

    def execute_query(self, sql_text: str, timeout_seconds: int, max_rows: int) -> dict[str, Any]:
        start = time.perf_counter()
        try:
            self.connect()
            with self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(f"SET statement_timeout = {int(timeout_seconds * 1000)};")
                cur.execute(sql_text)
                statement_type = self.classify_statement(sql_text)

                columns: list[str] = []
                rows: list[dict] = []
                row_count = cur.rowcount

                if cur.description:
                    columns = [desc[0] for desc in cur.description]
                    fetched = cur.fetchmany(max_rows)
                    rows = [dict(r) for r in fetched]
                    row_count = len(rows)

                if statement_type in ("write", "ddl"):
                    self._conn.commit()
                else:
                    self._conn.commit()  # end implicit transaction / release locks

                duration_ms = int((time.perf_counter() - start) * 1000)
                return {
                    "success": True,
                    "statement_type": statement_type,
                    "columns": columns,
                    "rows": rows,
                    "row_count": row_count,
                    "duration_ms": duration_ms,
                    "error": None,
                }
        except Exception as e:
            if self._conn:
                self._conn.rollback()
            duration_ms = int((time.perf_counter() - start) * 1000)
            return {
                "success": False,
                "statement_type": self.classify_statement(sql_text),
                "columns": [],
                "rows": [],
                "row_count": 0,
                "duration_ms": duration_ms,
                "error": str(e),
            }
        finally:
            self.disconnect()

    # ------------------------------------------------------------------
    # CRUD (dynamic — driven entirely by caller-supplied column/value maps)
    # ------------------------------------------------------------------
    def insert_row(self, schema: str, table: str, values: dict) -> dict[str, Any]:
        cols = list(values.keys())
        query = pgsql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING *").format(
            pgsql.Identifier(schema, table),
            pgsql.SQL(", ").join(map(pgsql.Identifier, cols)),
            pgsql.SQL(", ").join(pgsql.Placeholder() * len(cols)) if False else
            pgsql.SQL(", ").join([pgsql.SQL("%s")] * len(cols)),
        )
        with self._cursor() as cur:
            cur.execute(query, list(values.values()))
            row = cur.fetchone()
            self._conn.commit()
        return {"success": True, "row": dict(row) if row else None}

    def update_row(self, schema: str, table: str, pk: dict, values: dict) -> dict[str, Any]:
        set_clause = pgsql.SQL(", ").join(
            pgsql.SQL("{} = %s").format(pgsql.Identifier(k)) for k in values.keys()
        )
        where_clause = pgsql.SQL(" AND ").join(
            pgsql.SQL("{} = %s").format(pgsql.Identifier(k)) for k in pk.keys()
        )
        query = pgsql.SQL("UPDATE {} SET {} WHERE {} RETURNING *").format(
            pgsql.Identifier(schema, table), set_clause, where_clause
        )
        with self._cursor() as cur:
            cur.execute(query, list(values.values()) + list(pk.values()))
            row = cur.fetchone()
            self._conn.commit()
        return {"success": True, "row": dict(row) if row else None}

    def delete_row(self, schema: str, table: str, pk: dict) -> dict[str, Any]:
        where_clause = pgsql.SQL(" AND ").join(
            pgsql.SQL("{} = %s").format(pgsql.Identifier(k)) for k in pk.keys()
        )
        query = pgsql.SQL("DELETE FROM {} WHERE {}").format(pgsql.Identifier(schema, table), where_clause)
        with self._cursor() as cur:
            cur.execute(query, list(pk.values()))
            deleted = cur.rowcount
            self._conn.commit()
        return {"success": True, "deleted": deleted}

    # ------------------------------------------------------------------
    # DDL — builds and returns the SQL for a client-side preview; execution
    # goes through execute_query() after the user confirms.
    # ------------------------------------------------------------------
    def create_table(self, schema: str, table: str, columns: list[dict]) -> str:
        col_defs = []
        for c in columns:
            parts = [f'"{c["name"]}"', c["type"]]
            if not c.get("nullable", True):
                parts.append("NOT NULL")
            if c.get("primary_key"):
                parts.append("PRIMARY KEY")
            if c.get("default") is not None:
                parts.append(f"DEFAULT {c['default']}")
            col_defs.append(" ".join(parts))
        return f'CREATE TABLE "{schema}"."{table}" (\n  ' + ",\n  ".join(col_defs) + "\n);"

    def alter_table(self, schema: str, table: str, operations: list[dict]) -> str:
        statements = []
        for op in operations:
            kind = op.get("kind")
            if kind == "add_column":
                statements.append(
                    f'ALTER TABLE "{schema}"."{table}" ADD COLUMN "{op["name"]}" {op["type"]};'
                )
            elif kind == "drop_column":
                statements.append(f'ALTER TABLE "{schema}"."{table}" DROP COLUMN "{op["name"]}";')
            elif kind == "rename_column":
                statements.append(
                    f'ALTER TABLE "{schema}"."{table}" RENAME COLUMN "{op["from"]}" TO "{op["to"]}";'
                )
            elif kind == "alter_column_type":
                statements.append(
                    f'ALTER TABLE "{schema}"."{table}" ALTER COLUMN "{op["name"]}" TYPE {op["type"]};'
                )
        return "\n".join(statements)

    def drop_table(self, schema: str, table: str) -> str:
        return f'DROP TABLE "{schema}"."{table}";'

    # ------------------------------------------------------------------
    # Bulk import — used by the Excel-import feature. Optionally creates
    # the target table first (columns carry an inferred type in that case),
    # then bulk-inserts every row in batches via execute_values. Runs as a
    # single transaction: any failure rolls back the whole import so a
    # half-imported table is never left behind.
    # ------------------------------------------------------------------
    def import_rows(
        self, schema: str, table: str, columns: list[dict], rows: list[list[Any]], create: bool
    ) -> dict[str, Any]:
        col_names = [c["target_name"] for c in columns]
        try:
            self.connect()
            with self._conn.cursor() as cur:
                if create:
                    ddl_columns = [
                        {"name": c["target_name"], "type": c.get("type") or "TEXT", "nullable": True}
                        for c in columns
                    ]
                    cur.execute(self.create_table(schema, table, ddl_columns))

                if rows:
                    insert_sql = pgsql.SQL("INSERT INTO {} ({}) VALUES %s").format(
                        pgsql.Identifier(schema, table),
                        pgsql.SQL(", ").join(pgsql.Identifier(n) for n in col_names),
                    )
                    psycopg2.extras.execute_values(cur, insert_sql, rows, page_size=500)

                self._conn.commit()
            return {
                "success": True,
                "rows_imported": len(rows),
                "table": f"{schema}.{table}",
                "created_table": create,
            }
        except Exception as e:
            if self._conn:
                self._conn.rollback()
            return {"success": False, "error": str(e)}
        finally:
            self.disconnect()
