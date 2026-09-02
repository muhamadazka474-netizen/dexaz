"""
MySQL / MariaDB adapter — one implementation for both, karena keduanya
kompatibel secara wire-protocol & dialek SQL (perbedaan yang ada, misalnya
soal SEQUENCE, ditangani lewat percabangan kecil berdasarkan `db_type`).

Sama seperti PostgresAdapter: semua info struktural datang dari
information_schema / SHOW ..., tidak ada nama database/tabel/kolom yang
di-hardcode.

MySQL/MariaDB tidak punya konsep "schema" terpisah dari "database" seperti
PostgreSQL — satu koneksi selalu terikat ke satu database, dan itulah
satu-satunya "schema" yang ditampilkan (supaya sisa aplikasi, yang selalu
iterasi schema -> tables, tetap jalan tanpa perubahan).
"""
import time
from contextlib import contextmanager
from typing import Any, Optional

import pymysql
import pymysql.cursors

from app.adapters.base import DatabaseAdapter

WRITE_KEYWORDS = ("INSERT", "UPDATE", "DELETE", "REPLACE")
DDL_KEYWORDS = ("CREATE", "ALTER", "DROP", "TRUNCATE")


def _qi(name: str) -> str:
    """Quote a single identifier (backtick, dengan escape backtick ganda)."""
    return "`" + str(name).replace("`", "``") + "`"


def _qi_dotted(*parts: str) -> str:
    return ".".join(_qi(p) for p in parts if p)


class MySQLAdapter(DatabaseAdapter):
    db_type = "mysql"

    def __init__(self, host: str, port: int, database: str, username: str,
                 password: str, ssl_mode: str = "prefer", db_type: str = "mysql"):
        self.host = host
        self.port = port
        self.database = database
        self.username = username
        self.password = password
        self.ssl_mode = ssl_mode or "prefer"
        self.db_type = db_type  # "mysql" atau "mariadb"
        self._conn: Optional[pymysql.connections.Connection] = None

    # ------------------------------------------------------------------
    # connection lifecycle
    # ------------------------------------------------------------------
    def connect(self) -> None:
        ssl_arg = {} if self.ssl_mode == "disable" else {"ssl": {}}
        self._conn = pymysql.connect(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.username,
            password=self.password,
            connect_timeout=10,
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=False,
            **ssl_arg,
        )

    def disconnect(self) -> None:
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
        self._conn = None

    def test_connection(self) -> dict[str, Any]:
        try:
            self.connect()
            with self._conn.cursor() as cur:
                cur.execute("SELECT VERSION();")
                version = list(cur.fetchone().values())[0]
            return {"success": True, "message": "Connected", "server_version": version}
        except Exception as e:
            return {"success": False, "message": str(e)}
        finally:
            self.disconnect()

    @contextmanager
    def _cursor(self):
        opened_here = False
        if self._conn is None or not self._conn.open:
            self.connect()
            opened_here = True
        cur = self._conn.cursor()
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
                SELECT schema_name AS name,
                       ROUND(SUM(data_length + index_length)) AS size_bytes
                FROM information_schema.schemata s
                LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
                WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
                GROUP BY schema_name
                ORDER BY schema_name;
            """)
            rows = cur.fetchall()
            out = []
            for r in rows:
                size = r.get("size_bytes")
                out.append({"name": r["name"], "size": _human_size(size) if size else None})
            return out

    def get_schemas(self) -> list[dict[str, Any]]:
        # MySQL/MariaDB: satu koneksi = satu database = satu "schema".
        return [{"name": self.database}]

    def get_tables(self, schema: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT table_name AS name,
                       table_comment AS comment,
                       table_rows AS approx_row_count,
                       ROUND(data_length + index_length) AS size_bytes
                FROM information_schema.tables
                WHERE table_schema = %s AND table_type = 'BASE TABLE'
                ORDER BY table_name;
            """, (schema,))
            rows = cur.fetchall()
            out = []
            for r in rows:
                out.append({
                    "name": r["name"],
                    "comment": r.get("comment") or None,
                    "approx_row_count": r.get("approx_row_count"),
                    "size": _human_size(r.get("size_bytes")) if r.get("size_bytes") else None,
                })
            return out

    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT
                    column_name AS name,
                    data_type AS type,
                    character_maximum_length AS max_length,
                    numeric_precision AS numeric_precision,
                    numeric_scale AS numeric_scale,
                    is_nullable = 'YES' AS nullable,
                    column_default AS default_value,
                    ordinal_position AS position,
                    column_comment AS comment
                FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position;
            """, (schema, table))
            return list(cur.fetchall())

    def get_primary_keys(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT column_name, constraint_name
                FROM information_schema.key_column_usage
                WHERE table_schema = %s AND table_name = %s AND constraint_name = 'PRIMARY'
                ORDER BY ordinal_position;
            """, (schema, table))
            return list(cur.fetchall())

    def get_foreign_keys(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT
                    constraint_name,
                    column_name,
                    referenced_table_schema AS referenced_schema,
                    referenced_table_name AS referenced_table,
                    referenced_column_name AS referenced_column
                FROM information_schema.key_column_usage
                WHERE table_schema = %s AND table_name = %s
                  AND referenced_table_name IS NOT NULL;
            """, (schema, table))
            return list(cur.fetchall())

    def get_indexes(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT
                    index_name,
                    NOT non_unique AS is_unique,
                    index_name = 'PRIMARY' AS is_primary,
                    GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ', ') AS columns
                FROM information_schema.statistics
                WHERE table_schema = %s AND table_name = %s
                GROUP BY index_name, non_unique
                ORDER BY index_name;
            """, (schema, table))
            return list(cur.fetchall())

    def get_constraints(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT constraint_name, constraint_type
                FROM information_schema.table_constraints
                WHERE table_schema = %s AND table_name = %s
                ORDER BY constraint_type, constraint_name;
            """, (schema, table))
            return list(cur.fetchall())

    def get_views(self, schema: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT table_name AS name, view_definition AS definition
                FROM information_schema.views
                WHERE table_schema = %s
                ORDER BY table_name;
            """, (schema,))
            return list(cur.fetchall())

    def get_functions(self, schema: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT routine_name AS name, data_type AS return_type, ''  AS arguments
                FROM information_schema.routines
                WHERE routine_schema = %s AND routine_type = 'FUNCTION'
                ORDER BY routine_name;
            """, (schema,))
            return list(cur.fetchall())

    def get_sequences(self, schema: str) -> list[dict[str, Any]]:
        # SEQUENCE sebagai object eksplisit cuma ada di MariaDB 10.3+.
        # MySQL murni tidak punya konsep ini sama sekali -> selalu kosong.
        if self.db_type != "mariadb":
            return []
        try:
            with self._cursor() as cur:
                cur.execute("""
                    SELECT table_name AS name
                    FROM information_schema.tables
                    WHERE table_schema = %s AND table_type = 'SEQUENCE'
                    ORDER BY table_name;
                """, (schema,))
                return [{"name": r["name"], "data_type": None, "start_value": None, "increment": None}
                        for r in cur.fetchall()]
        except Exception:
            return []

    # ------------------------------------------------------------------
    # data
    # ------------------------------------------------------------------
    def get_table_data(
        self, schema: str, table: str, limit: int, offset: int,
        sort_column: Optional[str] = None, sort_dir: str = "asc",
        filters: Optional[list[dict]] = None,
    ) -> dict[str, Any]:
        base = f"FROM {_qi_dotted(schema, table)}"
        where_sql = ""
        params: list[Any] = []

        if filters:
            clauses = []
            op_map = {
                "=": "=", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=",
                "contains": "LIKE", "starts_with": "LIKE", "ends_with": "LIKE",
            }
            for f in filters:
                col = f.get("column")
                op = f.get("op", "=")
                val = f.get("value")
                sql_op = op_map.get(op, "=")
                if op == "contains":
                    val = f"%{val}%"
                elif op == "starts_with":
                    val = f"{val}%"
                elif op == "ends_with":
                    val = f"%{val}"
                clauses.append(f"{_qi(col)} {sql_op} %s")
                params.append(val)
            if clauses:
                where_sql = " WHERE " + " AND ".join(clauses)

        order_sql = ""
        if sort_column:
            direction = "ASC" if sort_dir.lower() != "desc" else "DESC"
            order_sql = f" ORDER BY {_qi(sort_column)} {direction}"

        with self._cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS total {base}{where_sql}", params)
            total = cur.fetchone()["total"]

            cur.execute(
                f"SELECT * {base}{where_sql}{order_sql} LIMIT %s OFFSET %s",
                params + [limit, offset],
            )
            rows = list(cur.fetchall())
            columns = [d[0] for d in cur.description] if cur.description else []

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
            with self._conn.cursor() as cur:
                # Timeout: berbeda antara MySQL & MariaDB, dan tidak semua
                # versi mendukungnya — jangan sampai gagal total kalau
                # variabel session ini tidak dikenali.
                try:
                    if self.db_type == "mariadb":
                        cur.execute(f"SET SESSION max_statement_time = {int(timeout_seconds)};")
                    else:
                        cur.execute(f"SET SESSION MAX_EXECUTION_TIME = {int(timeout_seconds * 1000)};")
                except Exception:
                    pass

                cur.execute(sql_text)
                statement_type = self.classify_statement(sql_text)

                columns: list[str] = []
                rows: list[dict] = []
                row_count = cur.rowcount

                if cur.description:
                    columns = [d[0] for d in cur.description]
                    fetched = cur.fetchmany(max_rows)
                    rows = list(fetched)
                    row_count = len(rows)

                self._conn.commit()

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
                try:
                    self._conn.rollback()
                except Exception:
                    pass
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
    # CRUD
    # ------------------------------------------------------------------
    def insert_row(self, schema: str, table: str, values: dict) -> dict[str, Any]:
        cols = list(values.keys())
        placeholders = ", ".join(["%s"] * len(cols))
        col_sql = ", ".join(_qi(c) for c in cols)
        with self._cursor() as cur:
            cur.execute(
                f"INSERT INTO {_qi_dotted(schema, table)} ({col_sql}) VALUES ({placeholders})",
                list(values.values()),
            )
            new_id = cur.lastrowid
            self._conn.commit()
            row = None
            if new_id:
                pk_cols = self.get_primary_keys(schema, table)
                if pk_cols:
                    cur.execute(
                        f"SELECT * FROM {_qi_dotted(schema, table)} WHERE {_qi(pk_cols[0]['column_name'])} = %s",
                        [new_id],
                    )
                    row = cur.fetchone()
        return {"success": True, "row": row}

    def update_row(self, schema: str, table: str, pk: dict, values: dict) -> dict[str, Any]:
        set_sql = ", ".join(f"{_qi(k)} = %s" for k in values.keys())
        where_sql = " AND ".join(f"{_qi(k)} = %s" for k in pk.keys())
        with self._cursor() as cur:
            cur.execute(
                f"UPDATE {_qi_dotted(schema, table)} SET {set_sql} WHERE {where_sql}",
                list(values.values()) + list(pk.values()),
            )
            self._conn.commit()
            cur.execute(
                f"SELECT * FROM {_qi_dotted(schema, table)} WHERE {where_sql}",
                list(pk.values()),
            )
            row = cur.fetchone()
        return {"success": True, "row": row}

    def delete_row(self, schema: str, table: str, pk: dict) -> dict[str, Any]:
        where_sql = " AND ".join(f"{_qi(k)} = %s" for k in pk.keys())
        with self._cursor() as cur:
            cur.execute(f"DELETE FROM {_qi_dotted(schema, table)} WHERE {where_sql}", list(pk.values()))
            deleted = cur.rowcount
            self._conn.commit()
        return {"success": True, "deleted": deleted}

    # ------------------------------------------------------------------
    # DDL — string preview, dieksekusi lewat execute_query() setelah user konfirmasi.
    # ------------------------------------------------------------------
    def create_table(self, schema: str, table: str, columns: list[dict]) -> str:
        col_defs = []
        for c in columns:
            parts = [_qi(c["name"]), c["type"]]
            if not c.get("nullable", True):
                parts.append("NOT NULL")
            if c.get("default") is not None:
                parts.append(f"DEFAULT {c['default']}")
            col_defs.append(" ".join(parts))
        pk_cols = [c["name"] for c in columns if c.get("primary_key")]
        if pk_cols:
            col_defs.append("PRIMARY KEY (" + ", ".join(_qi(c) for c in pk_cols) + ")")
        return f"CREATE TABLE {_qi_dotted(schema, table)} (\n  " + ",\n  ".join(col_defs) + "\n);"

    def alter_table(self, schema: str, table: str, operations: list[dict]) -> str:
        statements = []
        for op in operations:
            kind = op.get("kind")
            if kind == "add_column":
                statements.append(f"ALTER TABLE {_qi_dotted(schema, table)} ADD COLUMN {_qi(op['name'])} {op['type']};")
            elif kind == "drop_column":
                statements.append(f"ALTER TABLE {_qi_dotted(schema, table)} DROP COLUMN {_qi(op['name'])};")
            elif kind == "rename_column":
                # MySQL 8 / MariaDB 10.5+ mendukung RENAME COLUMN langsung.
                statements.append(
                    f"ALTER TABLE {_qi_dotted(schema, table)} RENAME COLUMN {_qi(op['from'])} TO {_qi(op['to'])};"
                )
            elif kind == "alter_column_type":
                statements.append(
                    f"ALTER TABLE {_qi_dotted(schema, table)} MODIFY COLUMN {_qi(op['name'])} {op['type']};"
                )
        return "\n".join(statements)

    def drop_table(self, schema: str, table: str) -> str:
        return f"DROP TABLE {_qi_dotted(schema, table)};"

    # ------------------------------------------------------------------
    # Bulk import
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
                    col_sql = ", ".join(_qi(n) for n in col_names)
                    placeholders = ", ".join(["%s"] * len(col_names))
                    insert_sql = f"INSERT INTO {_qi_dotted(schema, table)} ({col_sql}) VALUES ({placeholders})"
                    cur.executemany(insert_sql, rows)

                self._conn.commit()
            return {
                "success": True,
                "rows_imported": len(rows),
                "table": f"{schema}.{table}",
                "created_table": create,
            }
        except Exception as e:
            if self._conn:
                try:
                    self._conn.rollback()
                except Exception:
                    pass
            return {"success": False, "error": str(e)}
        finally:
            self.disconnect()


def _human_size(num_bytes: Optional[int]) -> Optional[str]:
    if num_bytes is None:
        return None
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024:
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} {unit}"
        size /= 1024
    return f"{size:.1f} PB"
