from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.adapters.factory import build_adapter
from app.audit.logger import log_action
from app.auth.dependencies import get_current_user
from app.database.session import get_db
from app.models.api_schemas import RelationshipCreateRequest, RelationshipDeleteRequest
from app.models.internal import DatabaseConnection, User

router = APIRouter(prefix="/api/databases/{connection_id}/erd", tags=["erd"])


@router.get("")
def get_erd(
    connection_id: str, schema: str = Query(...), database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """
    Returns, for every table in the schema: its columns (with type/nullable),
    primary key column names, foreign keys (with referenced table/column),
    and which columns carry a UNIQUE constraint — the last is used by the
    frontend to distinguish a one-to-one relationship (FK column is unique)
    from a one-to-many one (it isn't). Nothing here is table/column-specific
    hard-coding; it's all read live from introspection.
    """
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = build_adapter(conn, database)
    tables = adapter.get_tables(schema)

    result = []
    for t in tables:
        table_name = t["name"]
        columns = adapter.get_columns(schema, table_name)
        pks = [p["column_name"] for p in adapter.get_primary_keys(schema, table_name)]
        fks = adapter.get_foreign_keys(schema, table_name)
        indexes = adapter.get_indexes(schema, table_name)

        unique_columns = set(pks)
        for idx in indexes:
            if idx.get("is_unique"):
                for col in str(idx.get("columns", "")).split(", "):
                    if col:
                        unique_columns.add(col)

        result.append({
            "name": table_name,
            "columns": [
                {
                    "name": c["name"],
                    "type": c["type"],
                    "nullable": c["nullable"],
                    "is_primary_key": c["name"] in pks,
                    "is_unique": c["name"] in unique_columns,
                }
                for c in columns
            ],
            "primary_keys": pks,
            "foreign_keys": [
                {
                    "constraint_name": fk["constraint_name"],
                    "column": fk["column_name"],
                    "referenced_table": fk["referenced_table"],
                    "referenced_column": fk["referenced_column"],
                    "relationship": "one-to-one" if fk["column_name"] in unique_columns else "one-to-many",
                }
                for fk in fks
            ],
        })

    return {"schema": schema, "tables": result}


def _qi(name: str, db_type: str) -> str:
    if db_type in ("mysql", "mariadb"):
        return "`" + str(name).replace("`", "``") + "`"
    return '"' + str(name).replace('"', '""') + '"'


def _qualified(schema: str, table: str, db_type: str) -> str:
    return f"{_qi(schema, db_type)}.{_qi(table, db_type)}"


@router.post("/relationships")
def create_relationship(
    connection_id: str,
    payload: RelationshipCreateRequest,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """
    Menambahkan foreign key. Untuk Postgres/MySQL/MariaDB ini jalan lewat
    ALTER TABLE biasa. SQLite tidak punya ALTER TABLE ADD CONSTRAINT sama
    sekali, jadi untuk engine itu adapter membangun ulang tabelnya (lihat
    SQLiteAdapter.add_foreign_key) — datanya disalin otomatis, tidak hilang.
    """
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = build_adapter(conn, payload.database)
    constraint_name = f"fk_{payload.table}_{payload.column}"

    try:
        if conn.db_type == "sqlite":
            result = adapter.add_foreign_key(
                payload.schema_name, payload.table, payload.column,
                payload.ref_table, payload.ref_column, constraint_name,
            )
        else:
            sql = (
                f"ALTER TABLE {_qualified(payload.schema_name, payload.table, conn.db_type)} "
                f"ADD CONSTRAINT {_qi(constraint_name, conn.db_type)} "
                f"FOREIGN KEY ({_qi(payload.column, conn.db_type)}) "
                f"REFERENCES {_qualified(payload.schema_name, payload.ref_table, conn.db_type)} "
                f"({_qi(payload.ref_column, conn.db_type)});"
            )
            exec_result = adapter.execute_query(sql, timeout_seconds=30, max_rows=1)
            if not exec_result["success"]:
                raise ValueError(exec_result.get("error") or "Gagal membuat foreign key")
            result = {"success": True, "constraint_name": constraint_name}
    except Exception as e:
        log_action(
            db, current_user.id, action="ERD_ADD_FK", status="error",
            connection_id=conn.id, detail=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e))

    log_action(
        db, current_user.id, action="ERD_ADD_FK", status="success", connection_id=conn.id,
        detail=f"{payload.table}.{payload.column} -> {payload.ref_table}.{payload.ref_column}",
    )
    return result


@router.post("/relationships/delete")
def delete_relationship(
    connection_id: str,
    payload: RelationshipDeleteRequest,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Menghapus foreign key. Sama seperti create_relationship di atas —
    SQLite dikerjakan lewat rebuild tabel, engine lain lewat ALTER TABLE."""
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = build_adapter(conn, payload.database)

    try:
        if conn.db_type == "sqlite":
            result = adapter.drop_foreign_key(payload.schema_name, payload.table, payload.constraint_name)
        else:
            qualified = _qualified(payload.schema_name, payload.table, conn.db_type)
            if conn.db_type in ("mysql", "mariadb"):
                sql = f"ALTER TABLE {qualified} DROP FOREIGN KEY {_qi(payload.constraint_name, conn.db_type)};"
            else:
                sql = f"ALTER TABLE {qualified} DROP CONSTRAINT {_qi(payload.constraint_name, conn.db_type)};"
            exec_result = adapter.execute_query(sql, timeout_seconds=30, max_rows=1)
            if not exec_result["success"]:
                raise ValueError(exec_result.get("error") or "Gagal menghapus foreign key")
            result = {"success": True}
    except Exception as e:
        log_action(
            db, current_user.id, action="ERD_DROP_FK", status="error",
            connection_id=conn.id, detail=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e))

    log_action(
        db, current_user.id, action="ERD_DROP_FK", status="success", connection_id=conn.id,
        detail=f"{payload.table} constraint {payload.constraint_name}",
    )
    return result
