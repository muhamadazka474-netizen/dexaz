"""
DatabaseAdapter — the abstraction every target-database driver must
implement. PostgreSQL is the Phase 1 implementation; MySQL/MariaDB/SQLite
are meant to be added later behind this same interface so the rest of
the app (API routes, introspection, query engine) never needs to know
which engine it's talking to.

IMPORTANT: nothing in this interface or its implementations may
hard-code a database/schema/table/column name. Everything comes from
introspecting whatever is actually connected.
"""
from abc import ABC, abstractmethod
from typing import Any, Optional


class DatabaseAdapter(ABC):
    db_type: str = "base"

    # --- connection lifecycle ---
    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def disconnect(self) -> None: ...

    @abstractmethod
    def test_connection(self) -> dict[str, Any]: ...

    # --- introspection ---
    @abstractmethod
    def get_databases(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_schemas(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_tables(self, schema: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_primary_keys(self, schema: str, table: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_foreign_keys(self, schema: str, table: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_indexes(self, schema: str, table: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_constraints(self, schema: str, table: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_views(self, schema: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_functions(self, schema: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_sequences(self, schema: str) -> list[dict[str, Any]]: ...

    # --- data ---
    @abstractmethod
    def get_table_data(
        self, schema: str, table: str, limit: int, offset: int,
        sort_column: Optional[str] = None, sort_dir: str = "asc",
        filters: Optional[list[dict]] = None,
    ) -> dict[str, Any]: ...

    # --- query execution ---
    @abstractmethod
    def execute_query(self, sql: str, timeout_seconds: int, max_rows: int) -> dict[str, Any]: ...

    # --- CRUD ---
    @abstractmethod
    def insert_row(self, schema: str, table: str, values: dict) -> dict[str, Any]: ...

    @abstractmethod
    def update_row(self, schema: str, table: str, pk: dict, values: dict) -> dict[str, Any]: ...

    @abstractmethod
    def delete_row(self, schema: str, table: str, pk: dict) -> dict[str, Any]: ...

    # --- DDL ---
    @abstractmethod
    def create_table(self, schema: str, table: str, columns: list[dict]) -> str: ...

    @abstractmethod
    def alter_table(self, schema: str, table: str, operations: list[dict]) -> str: ...

    @abstractmethod
    def drop_table(self, schema: str, table: str) -> str: ...

    # --- bulk data import (Excel/CSV → table) ---
    @abstractmethod
    def import_rows(
        self, schema: str, table: str, columns: list[dict], rows: list[list[Any]], create: bool
    ) -> dict[str, Any]: ...

    # --- relationship management ---
    # Not abstract: most engines (Postgres, MySQL/MariaDB) add/drop foreign
    # keys with a plain ALTER TABLE, which the API layer builds itself and
    # runs through execute_query() — no adapter method needed. SQLite is the
    # exception (no ALTER TABLE ADD/DROP CONSTRAINT at all), so only
    # SQLiteAdapter overrides these with the actual table-rebuild logic.
    def add_foreign_key(
        self, schema: str, table: str, column: str,
        ref_table: str, ref_column: str, constraint_name: str,
    ) -> dict[str, Any]:
        raise NotImplementedError(f"add_foreign_key belum diimplementasikan untuk adapter '{self.db_type}'.")

    def drop_foreign_key(self, schema: str, table: str, constraint_name: str) -> dict[str, Any]:
        raise NotImplementedError(f"drop_foreign_key belum diimplementasikan untuk adapter '{self.db_type}'.")
