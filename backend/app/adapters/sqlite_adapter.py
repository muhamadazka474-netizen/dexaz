"""
SQLite adapter — target database di sini adalah satu FILE lokal (bukan
server host:port). Tidak ada username/password/host/port sama sekali,
cuma path ke file .db/.sqlite.

SQLite tidak punya konsep schema jamak seperti PostgreSQL, jadi
get_schemas() selalu mengembalikan satu entry "main" (nama schema bawaan
SQLite) supaya sisa aplikasi yang selalu iterasi schema -> tables tetap
jalan tanpa perubahan.
"""
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Optional

from app.adapters.base import DatabaseAdapter

WRITE_KEYWORDS = ("INSERT", "UPDATE", "DELETE", "REPLACE")
DDL_KEYWORDS = ("CREATE", "ALTER", "DROP", "TRUNCATE")


def _qi(name: str) -> str:
    """Quote satu identifier ala SQLite (double-quote, escape "" ganda)."""
    return '"' + str(name).replace('"', '""') + '"'


class SQLiteAdapter(DatabaseAdapter):
    db_type = "sqlite"

    def __init__(self, sqlite_path: str):
        self.sqlite_path = sqlite_path
        self._conn: Optional[sqlite3.Connection] = None

    # ------------------------------------------------------------------
    # connection lifecycle
    # ------------------------------------------------------------------
    def connect(self) -> None:
        # check_same_thread=False: FastAPI bisa menangani request di thread
        # berbeda; ini alat local-first single-user jadi aman dipakai di sini.
        self._conn = sqlite3.connect(self.sqlite_path, timeout=10, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON;")

    def disconnect(self) -> None:
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
        self._conn = None

    def test_connection(self) -> dict[str, Any]:
        try:
            if not os.path.exists(self.sqlite_path):
                return {"success": False, "message": f"File tidak ditemukan: {self.sqlite_path}"}
            self.connect()
            cur = self._conn.execute("SELECT sqlite_version();")
            version = cur.fetchone()[0]
            return {"success": True, "message": "Connected", "server_version": f"SQLite {version}"}
        except Exception as e:
            return {"success": False, "message": str(e)}
        finally:
            self.disconnect()

    @contextmanager
    def _cursor(self):
        opened_here = False
        if self._conn is None:
            self.connect()
            opened_here = True
        cur = self._conn.cursor()
        try:
            yield cur
        finally:
            cur.close()
            if opened_here:
                self.disconnect()

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        return dict(row) if row is not None else None

    @staticmethod
    def _rows_to_dicts(rows) -> list[dict]:
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # introspection
    # ------------------------------------------------------------------
    def get_databases(self) -> list[dict[str, Any]]:
        try:
            size_bytes = os.path.getsize(self.sqlite_path) if os.path.exists(self.sqlite_path) else 0
        except OSError:
            size_bytes = 0
        name = os.path.basename(self.sqlite_path)
        return [{"name": name, "size": _human_size(size_bytes)}]

    def get_schemas(self) -> list[dict[str, Any]]:
        return [{"name": "main"}]

    def get_tables(self, schema: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                ORDER BY name;
            """)
            names = [r["name"] for r in cur.fetchall()]

        out = []
        with self._cursor() as cur:
            for name in names:
                try:
                    cur.execute(f"SELECT COUNT(*) AS c FROM {_qi(name)};")
                    count = cur.fetchone()["c"]
                except Exception:
                    count = None
                out.append({"name": name, "comment": None, "approx_row_count": count, "size": None})
        return out

    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute(f"PRAGMA table_info({_qi(table)});")
            rows = cur.fetchall()
        out = []
        for r in rows:
            out.append({
                "name": r["name"],
                "type": r["type"] or "TEXT",
                "max_length": None,
                "numeric_precision": None,
                "numeric_scale": None,
                "nullable": r["notnull"] == 0,
                "default_value": r["dflt_value"],
                "position": r["cid"] + 1,
                "comment": None,
            })
        return out

    def get_primary_keys(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute(f"PRAGMA table_info({_qi(table)});")
            rows = [r for r in cur.fetchall() if r["pk"] and r["pk"] > 0]
        rows.sort(key=lambda r: r["pk"])
        return [{"column_name": r["name"], "constraint_name": "PRIMARY KEY"} for r in rows]

    def get_foreign_keys(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute(f"PRAGMA foreign_key_list({_qi(table)});")
            rows = cur.fetchall()
        return [
            {
                "constraint_name": f"fk_{table}_{r['id']}",
                "column_name": r["from"],
                "referenced_schema": "main",
                "referenced_table": r["table"],
                "referenced_column": r["to"],
            }
            for r in rows
        ]

    def get_indexes(self, schema: str, table: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute(f"PRAGMA index_list({_qi(table)});")
            idx_rows = cur.fetchall()
            out = []
            for idx in idx_rows:
                cur.execute(f"PRAGMA index_info({_qi(idx['name'])});")
                cols = [c["name"] for c in cur.fetchall()]
                out.append({
                    "index_name": idx["name"],
                    "is_unique": bool(idx["unique"]),
                    "is_primary": idx["origin"] == "pk",
                    "columns": ", ".join(cols),
                    "size": None,
                })
        return out

    def get_constraints(self, schema: str, table: str) -> list[dict[str, Any]]:
        # SQLite tidak punya katalog constraint bernama seperti information_schema.
        # PK/FK/UNIQUE sudah tersedia lewat get_primary_keys/get_foreign_keys/get_indexes.
        return []

    def get_views(self, schema: str) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("""
                SELECT name, sql AS definition FROM sqlite_master
                WHERE type = 'view'
                ORDER BY name;
            """)
            return self._rows_to_dicts(cur.fetchall())

    def get_functions(self, schema: str) -> list[dict[str, Any]]:
        # SQLite tidak punya katalog fungsi SQL yang bisa diintrospeksi.
        return []

    def get_sequences(self, schema: str) -> list[dict[str, Any]]:
        # Tidak ada objek SEQUENCE umum; sqlite_sequence cuma internal utk AUTOINCREMENT.
        return []

    # ------------------------------------------------------------------
    # data
    # ------------------------------------------------------------------
    def get_table_data(
        self, schema: str, table: str, limit: int, offset: int,
        sort_column: Optional[str] = None, sort_dir: str = "asc",
        filters: Optional[list[dict]] = None,
    ) -> dict[str, Any]:
        base = f"FROM {_qi(table)}"
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
                clauses.append(f"{_qi(col)} {sql_op} ?")
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

            cur.execute(f"SELECT * {base}{where_sql}{order_sql} LIMIT ? OFFSET ?", params + [limit, offset])
            rows = self._rows_to_dicts(cur.fetchall())
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
        if first_word in ("SELECT", "WITH", "EXPLAIN"):
            return "read"
        return "other"

    def execute_query(self, sql_text: str, timeout_seconds: int, max_rows: int) -> dict[str, Any]:
        # SQLite tidak punya "statement timeout" per-query seperti server DB;
        # `timeout` di connect() cuma busy-wait untuk lock, bukan pembatas
        # durasi eksekusi. Parameter timeout_seconds diterima demi konsistensi
        # interface tapi tidak benar-benar membatasi durasi query di sini.
        start = time.perf_counter()
        try:
            self.connect()
            cur = self._conn.cursor()
            cur.execute(sql_text)
            statement_type = self.classify_statement(sql_text)

            columns: list[str] = []
            rows: list[dict] = []
            row_count = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

            if cur.description:
                columns = [d[0] for d in cur.description]
                fetched = cur.fetchmany(max_rows)
                rows = self._rows_to_dicts(fetched)
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
                "error": self._friendlier_error(sql_text, str(e)),
            }
        finally:
            self.disconnect()

    @staticmethod
    def _friendlier_error(sql_text: str, raw_error: str) -> str:
        """SQLite tidak mengenal ALTER TABLE ADD/DROP CONSTRAINT sama sekali
        (bukan cuma untuk foreign key — sintaksnya memang tidak ada di
        SQLite), jadi pesan aslinya cuma 'near "CONSTRAINT": syntax error'
        yang membingungkan. Deteksi pola ini dan beri penjelasan + arahan
        ke halaman ERD Diagram, yang sudah menangani penambahan/penghapusan
        foreign key untuk SQLite lewat rebuild tabel otomatis."""
        normalized = re.sub(r"\s+", " ", sql_text or "").strip().upper()
        if "ALTER TABLE" in normalized and ("ADD CONSTRAINT" in normalized or "DROP CONSTRAINT" in normalized):
            return (
                f"{raw_error} — SQLite tidak mendukung ALTER TABLE ADD/DROP CONSTRAINT sama sekali "
                "(bukan cuma untuk foreign key). Relasi di SQLite hanya bisa didefinisikan saat tabel "
                "dibuat, jadi menambah/menghapusnya berarti tabel harus dibangun ulang. Gunakan menu "
                "ERD Diagram untuk ini — sambungkan/putuskan relasi lewat kanvas ERD, dan aplikasi akan "
                "membangun ulang tabelnya secara otomatis (data ikut disalin, tidak hilang)."
            )
        return raw_error

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    def insert_row(self, schema: str, table: str, values: dict) -> dict[str, Any]:
        cols = list(values.keys())
        placeholders = ", ".join(["?"] * len(cols))
        col_sql = ", ".join(_qi(c) for c in cols)
        with self._cursor() as cur:
            cur.execute(
                f"INSERT INTO {_qi(table)} ({col_sql}) VALUES ({placeholders})",
                list(values.values()),
            )
            new_id = cur.lastrowid
            self._conn.commit()
            row = None
            if new_id is not None:
                pk_cols = self.get_primary_keys(schema, table)
                if pk_cols:
                    cur.execute(
                        f"SELECT * FROM {_qi(table)} WHERE {_qi(pk_cols[0]['column_name'])} = ?",
                        [new_id],
                    )
                else:
                    cur.execute(f"SELECT * FROM {_qi(table)} WHERE rowid = ?", [new_id])
                row = self._row_to_dict(cur.fetchone())
        return {"success": True, "row": row}

    def update_row(self, schema: str, table: str, pk: dict, values: dict) -> dict[str, Any]:
        set_sql = ", ".join(f"{_qi(k)} = ?" for k in values.keys())
        where_sql = " AND ".join(f"{_qi(k)} = ?" for k in pk.keys())
        with self._cursor() as cur:
            cur.execute(
                f"UPDATE {_qi(table)} SET {set_sql} WHERE {where_sql}",
                list(values.values()) + list(pk.values()),
            )
            self._conn.commit()
            cur.execute(f"SELECT * FROM {_qi(table)} WHERE {where_sql}", list(pk.values()))
            row = self._row_to_dict(cur.fetchone())
        return {"success": True, "row": row}

    def delete_row(self, schema: str, table: str, pk: dict) -> dict[str, Any]:
        where_sql = " AND ".join(f"{_qi(k)} = ?" for k in pk.keys())
        with self._cursor() as cur:
            cur.execute(f"DELETE FROM {_qi(table)} WHERE {where_sql}", list(pk.values()))
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
            if c.get("primary_key"):
                parts.append("PRIMARY KEY")
            if not c.get("nullable", True) and not c.get("primary_key"):
                parts.append("NOT NULL")
            if c.get("default") is not None:
                parts.append(f"DEFAULT {c['default']}")
            col_defs.append(" ".join(parts))
        return f"CREATE TABLE {_qi(table)} (\n  " + ",\n  ".join(col_defs) + "\n);"

    def alter_table(self, schema: str, table: str, operations: list[dict]) -> str:
        # SQLite (3.35+) cuma dukung ADD COLUMN, DROP COLUMN, RENAME COLUMN,
        # RENAME TABLE lewat ALTER TABLE. Ubah tipe kolom butuh recreate tabel
        # manual (tidak didukung langsung) — ditandai jelas di komentar SQL.
        statements = []
        for op in operations:
            kind = op.get("kind")
            if kind == "add_column":
                statements.append(f"ALTER TABLE {_qi(table)} ADD COLUMN {_qi(op['name'])} {op['type']};")
            elif kind == "drop_column":
                statements.append(f"ALTER TABLE {_qi(table)} DROP COLUMN {_qi(op['name'])};")
            elif kind == "rename_column":
                statements.append(f"ALTER TABLE {_qi(table)} RENAME COLUMN {_qi(op['from'])} TO {_qi(op['to'])};")
            elif kind == "alter_column_type":
                statements.append(
                    f"-- SQLite tidak mendukung ALTER COLUMN TYPE secara langsung.\n"
                    f"-- Perlu: buat tabel baru dengan tipe kolom {_qi(op['name'])} yang diinginkan, "
                    f"salin data, DROP tabel lama, lalu RENAME tabel baru ke '{table}'."
                )
        return "\n".join(statements)

    def drop_table(self, schema: str, table: str) -> str:
        return f"DROP TABLE {_qi(table)};"

    # ------------------------------------------------------------------
    # Relationship management — SQLite has no ALTER TABLE ADD/DROP
    # CONSTRAINT at all; a foreign key can only be declared at CREATE
    # TABLE time. Adding/removing one means rebuilding the table: create
    # a new table with the desired FK set, copy the data across, drop the
    # old table, then rename the new one into its place. This follows the
    # procedure SQLite's own docs recommend for schema changes ALTER
    # TABLE can't express: https://www.sqlite.org/lang_altertable.html
    # ------------------------------------------------------------------
    def _table_rebuild_parts(self, table: str) -> dict[str, Any]:
        """Baca definisi tabel saat ini: kolom, FK yang sudah ada, DDL asli
        (untuk deteksi AUTOINCREMENT), dan index bernama yang perlu dibuat
        ulang setelah tabel di-rebuild."""
        with self._cursor() as cur:
            cur.execute(f"PRAGMA table_info({_qi(table)});")
            columns = self._rows_to_dicts(cur.fetchall())

            cur.execute(f"PRAGMA foreign_key_list({_qi(table)});")
            fk_rows = self._rows_to_dicts(cur.fetchall())

            cur.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?;", [table]
            )
            row = cur.fetchone()
            create_sql = row["sql"] if row else ""

            cur.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL;",
                [table],
            )
            index_sqls = [r["sql"] for r in cur.fetchall()]

        fks_by_id: dict[int, list[dict]] = {}
        for r in fk_rows:
            fks_by_id.setdefault(r["id"], []).append(r)

        return {
            "columns": columns,
            "fks_by_id": fks_by_id,
            "create_sql": create_sql or "",
            "index_sqls": index_sqls,
        }

    def _describe_fk_violations(self, cur, violations: list[dict], max_examples: int = 15) -> str:
        """PRAGMA foreign_key_check cuma memberi (table, rowid, parent, fkid) —
        tidak menyebut kolom atau nilai apa yang bermasalah. Fungsi ini
        menerjemahkannya jadi pesan yang bisa langsung dipakai user: tabel
        mana, baris mana (pakai primary key kalau ada, bukan rowid internal),
        kolom mana, nilainya apa, dan seharusnya cocok ke mana."""
        total = len(violations)
        lines: list[str] = []
        fk_cache: dict[tuple[str, int], list[dict]] = {}
        pk_cache: dict[str, list[str]] = {}

        for v in violations[:max_examples]:
            vtable = v["table"]
            rowid = v["rowid"]
            fkid = v["fkid"]

            if vtable not in pk_cache:
                cur.execute(f"PRAGMA table_info({_qi(vtable)});")
                info = self._rows_to_dicts(cur.fetchall())
                pk_cache[vtable] = [
                    c["name"] for c in sorted(
                        [c for c in info if c["pk"] and c["pk"] > 0], key=lambda c: c["pk"]
                    )
                ]

            key = (vtable, fkid)
            if key not in fk_cache:
                cur.execute(f"PRAGMA foreign_key_list({_qi(vtable)});")
                fk_rows = self._rows_to_dicts(cur.fetchall())
                fk_cache[key] = sorted([r for r in fk_rows if r["id"] == fkid], key=lambda r: r["seq"])
            fk_cols = fk_cache[key]

            pk_names = pk_cache[vtable]
            row_label = f"rowid={rowid}"
            if pk_names:
                try:
                    sel = ", ".join(_qi(n) for n in pk_names)
                    cur.execute(f"SELECT {sel} FROM {_qi(vtable)} WHERE rowid = ?;", [rowid])
                    r = cur.fetchone()
                    if r:
                        row_label = ", ".join(f"{n}={r[i]!r}" for i, n in enumerate(pk_names))
                except Exception:
                    pass

            if not fk_cols:
                lines.append(f"- Tabel '{vtable}', baris ({row_label}): melanggar salah satu foreign key.")
                continue

            for fc in fk_cols:
                col_name, ref_table, ref_col = fc["from"], fc["table"], fc["to"]
                try:
                    cur.execute(f"SELECT {_qi(col_name)} FROM {_qi(vtable)} WHERE rowid = ?;", [rowid])
                    r = cur.fetchone()
                    value = r[0] if r else None
                except Exception:
                    value = "?"
                lines.append(
                    f"- Tabel '{vtable}', baris ({row_label}): kolom '{col_name}' bernilai {value!r} "
                    f"tidak ditemukan di '{ref_table}.{ref_col}'."
                )

        text = "\n".join(lines)
        if total > max_examples:
            text += f"\n… dan {total - max_examples} pelanggaran lain yang serupa (ditampilkan {max_examples} pertama)."
        return text

    def _rebuild_table(
        self, table: str, fks_by_id: dict[int, list[dict]],
        columns: list[dict], create_sql: str, index_sqls: list[str],
    ) -> None:
        has_autoincrement = "AUTOINCREMENT" in create_sql.upper()
        pk_cols = sorted(
            [c for c in columns if c["pk"] and c["pk"] > 0], key=lambda c: c["pk"]
        )
        single_int_pk = len(pk_cols) == 1 and (pk_cols[0]["type"] or "").upper() == "INTEGER"

        col_defs = []
        for c in columns:
            is_single_pk_col = single_int_pk and pk_cols[0]["name"] == c["name"]
            parts = [_qi(c["name"]), c["type"] or "TEXT"]
            if is_single_pk_col:
                parts.append("PRIMARY KEY")
                if has_autoincrement:
                    parts.append("AUTOINCREMENT")
            if c["notnull"] and not is_single_pk_col:
                parts.append("NOT NULL")
            if c["dflt_value"] is not None:
                parts.append(f"DEFAULT {c['dflt_value']}")
            col_defs.append(" ".join(parts))

        if pk_cols and not single_int_pk:
            pk_list = ", ".join(_qi(c["name"]) for c in pk_cols)
            col_defs.append(f"PRIMARY KEY ({pk_list})")

        for rows in fks_by_id.values():
            rows_sorted = sorted(rows, key=lambda r: r["seq"])
            from_cols = ", ".join(_qi(r["from"]) for r in rows_sorted)
            to_cols = ", ".join(_qi(r["to"]) for r in rows_sorted)
            ref_table = rows_sorted[0]["table"]
            clause = f"FOREIGN KEY ({from_cols}) REFERENCES {_qi(ref_table)} ({to_cols})"
            on_delete = rows_sorted[0].get("on_delete")
            on_update = rows_sorted[0].get("on_update")
            if on_delete and on_delete != "NO ACTION":
                clause += f" ON DELETE {on_delete}"
            if on_update and on_update != "NO ACTION":
                clause += f" ON UPDATE {on_update}"
            col_defs.append(clause)

        col_names = ", ".join(_qi(c["name"]) for c in columns)
        tmp_name = f"{table}__dbx_rebuild"

        with self._cursor() as cur:
            # PRAGMA foreign_keys hanya efektif diubah di luar transaksi.
            cur.execute("PRAGMA foreign_keys = OFF;")
            cur.execute("BEGIN IMMEDIATE;")
            try:
                cur.execute(f"DROP TABLE IF EXISTS {_qi(tmp_name)};")
                cur.execute(f"CREATE TABLE {_qi(tmp_name)} (\n  " + ",\n  ".join(col_defs) + "\n);")
                cur.execute(
                    f"INSERT INTO {_qi(tmp_name)} ({col_names}) SELECT {col_names} FROM {_qi(table)};"
                )
                cur.execute(f"DROP TABLE {_qi(table)};")
                cur.execute(f"ALTER TABLE {_qi(tmp_name)} RENAME TO {_qi(table)};")
                for idx_sql in index_sqls:
                    cur.execute(idx_sql)
                cur.execute("PRAGMA foreign_key_check;")
                violations = self._rows_to_dicts(cur.fetchall())
                if violations:
                    detail = self._describe_fk_violations(cur, violations)
                    raise ValueError(
                        "Perubahan ini ditolak karena melanggar foreign key terhadap data yang sudah ada "
                        f"({len(violations)} baris bermasalah):\n{detail}"
                    )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            finally:
                cur.execute("PRAGMA foreign_keys = ON;")

    def add_foreign_key(
        self, schema: str, table: str, column: str,
        ref_table: str, ref_column: str, constraint_name: str,
    ) -> dict[str, Any]:
        parts = self._table_rebuild_parts(table)
        columns = parts["columns"]
        if not any(c["name"] == column for c in columns):
            raise ValueError(f"Kolom '{column}' tidak ditemukan di tabel '{table}'.")

        ref_columns = self.get_columns(schema, ref_table)
        if not any(c["name"] == ref_column for c in ref_columns):
            raise ValueError(f"Kolom '{ref_column}' tidak ditemukan di tabel '{ref_table}'.")

        fks_by_id: dict[int, list[dict]] = dict(parts["fks_by_id"])
        if any(r["from"] == column for rows in fks_by_id.values() for r in rows):
            raise ValueError(f"Kolom '{column}' sudah punya foreign key. Hapus dulu sebelum menambah yang baru.")

        next_id = (max(fks_by_id.keys()) + 1) if fks_by_id else 0
        fks_by_id[next_id] = [{
            "seq": 0, "from": column, "table": ref_table, "to": ref_column,
            "on_delete": "NO ACTION", "on_update": "NO ACTION",
        }]

        self._rebuild_table(table, fks_by_id, columns, parts["create_sql"], parts["index_sqls"])
        return {"success": True, "constraint_name": f"fk_{table}_{next_id}"}

    def drop_foreign_key(self, schema: str, table: str, constraint_name: str) -> dict[str, Any]:
        parts = self._table_rebuild_parts(table)
        columns = parts["columns"]
        fks_by_id: dict[int, list[dict]] = dict(parts["fks_by_id"])

        prefix = f"fk_{table}_"
        if not constraint_name.startswith(prefix):
            raise ValueError(f"Nama constraint '{constraint_name}' tidak dikenali untuk tabel '{table}'.")
        try:
            target_id = int(constraint_name[len(prefix):])
        except ValueError:
            raise ValueError(f"Nama constraint '{constraint_name}' tidak valid.")

        if target_id not in fks_by_id:
            raise ValueError(f"Relasi '{constraint_name}' tidak ditemukan di tabel '{table}'.")
        del fks_by_id[target_id]

        self._rebuild_table(table, fks_by_id, columns, parts["create_sql"], parts["index_sqls"])
        return {"success": True}

    # ------------------------------------------------------------------
    # Bulk import
    # ------------------------------------------------------------------
    def import_rows(
        self, schema: str, table: str, columns: list[dict], rows: list[list[Any]], create: bool
    ) -> dict[str, Any]:
        col_names = [c["target_name"] for c in columns]
        try:
            self.connect()
            cur = self._conn.cursor()
            if create:
                ddl_columns = [
                    {"name": c["target_name"], "type": c.get("type") or "TEXT", "nullable": True}
                    for c in columns
                ]
                cur.execute(self.create_table(schema, table, ddl_columns))

            if rows:
                col_sql = ", ".join(_qi(n) for n in col_names)
                placeholders = ", ".join(["?"] * len(col_names))
                insert_sql = f"INSERT INTO {_qi(table)} ({col_sql}) VALUES ({placeholders})"
                cur.executemany(insert_sql, rows)

            self._conn.commit()
            return {
                "success": True,
                "rows_imported": len(rows),
                "table": table,
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
