from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.adapters.factory import build_adapter
from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.dashboard.profiling import profile_columns
from app.database.session import get_db
from app.models.internal import DatabaseConnection, QueryHistory, SavedQuery, User
from app.schema import introspection

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_ALLOWED_AGG = {"sum", "avg", "count", "min", "max"}


def _quote_ident(name: str, db_type: str = "postgresql") -> str:
    """Quote a column/table identifier for interpolation into SQL. Quote
    character depends on the engine — MySQL/MariaDB use backticks (double
    quotes are a *string literal* there unless ANSI_QUOTES is enabled,
    which we don't assume); Postgres and SQLite both use double quotes.
    Rejects anything containing the matching quote char so an identifier
    can never be used to break out of the identifier position."""
    if not isinstance(name, str) or not name:
        raise HTTPException(status_code=400, detail="Nama kolom tidak valid")
    if db_type in ("mysql", "mariadb"):
        if "`" in name:
            raise HTTPException(status_code=400, detail="Nama kolom tidak valid")
        return f"`{name}`"
    if '"' in name:
        raise HTTPException(status_code=400, detail="Nama kolom tidak valid")
    return f'"{name}"'


def _numeric_cast(expr: str, db_type: str) -> str:
    """Cast an expression to a numeric type before SUM/AVG/MIN/MAX so text
    columns storing numbers still aggregate correctly. `::numeric` is
    Postgres-only syntax (SQLite doesn't recognize the `:` token at all,
    which is exactly the "unrecognized token: ':'" error) — every engine
    needs its own cast syntax."""
    if db_type == "sqlite":
        return f"CAST({expr} AS REAL)"
    if db_type in ("mysql", "mariadb"):
        return f"CAST({expr} AS DECIMAL(30,6))"
    return f"({expr})::numeric"


def _resolve_source(payload: dict, db: Session):
    """Shared source resolution for every dashboard endpoint that profiles
    or aggregates a table/saved query/ad-hoc SQL: validates the connection,
    builds the base SELECT, and refuses anything that isn't a read query.
    Returns (adapter, base_sql, source_label, db_type).
    """
    connection_id = payload.get("connection_id")
    if not connection_id:
        raise HTTPException(status_code=400, detail="connection_id wajib diisi")
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    db_type = conn.db_type
    schema = payload.get("schema")
    table = payload.get("table")
    saved_query_id = payload.get("saved_query_id")
    sql_override = payload.get("sql")

    if saved_query_id:
        sq = db.query(SavedQuery).filter(SavedQuery.id == saved_query_id).first()
        if not sq:
            raise HTTPException(status_code=404, detail="Saved query not found")
        base_sql = sq.sql_text.strip().rstrip(";")
        source_label = sq.name
    elif sql_override:
        base_sql = sql_override.strip().rstrip(";")
        source_label = "Query Builder"
    elif schema and table:
        base_sql = f"SELECT * FROM {_quote_ident(schema, db_type)}.{_quote_ident(table, db_type)}"
        source_label = f"{schema}.{table}"
    else:
        raise HTTPException(
            status_code=400, detail="Butuh schema+table, saved_query_id, atau sql"
        )

    adapter = build_adapter(conn, payload.get("database"))

    # Only ever run read queries — never let these endpoints run something
    # destructive just because they were handed raw SQL.
    if adapter.classify_statement(base_sql) != "read":
        raise HTTPException(status_code=400, detail="Hanya query SELECT yang bisa diringkas")

    return adapter, base_sql, source_label, db_type


@router.get("/summary")
def summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    connections = db.query(DatabaseConnection).all()
    table_count = 0
    view_count = 0
    for conn in connections:
        try:
            adapter = build_adapter(conn)
            tree = introspection.get_metadata_tree(conn.id, adapter)
            for s in tree["schemas"]:
                table_count += len(s["tables"])
                view_count += len(s["views"])
        except Exception:
            continue

    query_count = db.query(QueryHistory).count()
    saved_query_count = db.query(SavedQuery).count()

    return {
        "connections": len(connections),
        "tables": table_count,
        "views": view_count,
        "queries_run": query_count,
        "saved_queries": saved_query_count,
    }


@router.post("/table-summary")
def table_summary(
    payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """Profiles a table or a saved/ad-hoc query: row count + per-column
    stats (nulls, distinct count, min/max/avg or top values). Runs against
    a bounded sample for large sources — `is_sampled` tells the frontend
    whether the stats cover every row or just a prefix of them.
    """
    adapter, base_sql, source_label, _db_type = _resolve_source(payload, db)
    sample_limit = settings.dbx_max_rows_returned
    sample_sql = f"SELECT * FROM ({base_sql}) AS _dexaz_summary_src LIMIT {sample_limit}"
    count_sql = f"SELECT COUNT(*) AS total FROM ({base_sql}) AS _dexaz_summary_src"

    sample_result = adapter.execute_query(
        sample_sql, timeout_seconds=settings.dbx_query_timeout_seconds, max_rows=sample_limit
    )
    if not sample_result["success"]:
        raise HTTPException(status_code=400, detail=sample_result["error"])

    count_result = adapter.execute_query(
        count_sql, timeout_seconds=settings.dbx_query_timeout_seconds, max_rows=1
    )
    total_rows = (
        count_result["rows"][0]["total"]
        if count_result["success"] and count_result["rows"]
        else sample_result["row_count"]
    )

    profiles = profile_columns(sample_result["columns"], sample_result["rows"])

    return {
        "source": source_label,
        "columns": sample_result["columns"],
        "column_profiles": profiles,
        "total_rows": total_rows,
        "sampled_rows": sample_result["row_count"],
        "is_sampled": total_rows > sample_result["row_count"],
    }


@router.post("/report")
def report(
    payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """Builds report data for the Dashboard's "Laporan" panel, on top of
    the same table / saved-query / ad-hoc-SQL sources as /table-summary.
    Two modes:

    - mode="totals": grand totals (sum/avg/min/max) for a set of chosen
      numeric columns, computed with SQL aggregates over the *entire*
      result set (not a sample) — used for KPI cards and "total nominal".
    - mode="grouped": one row per distinct value of `group_by`, aggregated
      by `agg` over `value_column` (or COUNT(*) when agg="count") — used
      to feed pie / column / line charts on the frontend. Also returns a
      `grand_total` computed over the ungrouped result when the aggregate
      is sum/count, so the frontend can show it alongside the chart.
    """
    adapter, base_sql, source_label, db_type = _resolve_source(payload, db)
    mode = payload.get("mode")

    if mode == "totals":
        columns = payload.get("columns") or []
        if not isinstance(columns, list) or not columns:
            raise HTTPException(status_code=400, detail="Pilih minimal satu kolom")
        if len(columns) > 12:
            raise HTTPException(status_code=400, detail="Maksimal 12 kolom sekaligus")

        select_parts = []
        for col in columns:
            c = _quote_ident(col, db_type)
            cast = _numeric_cast(c, db_type)
            select_parts.append(f'SUM({cast}) AS "{col}__sum"')
            select_parts.append(f'AVG({cast}) AS "{col}__avg"')
            select_parts.append(f'MIN({cast}) AS "{col}__min"')
            select_parts.append(f'MAX({cast}) AS "{col}__max"')

        sql = (
            f"SELECT COUNT(*) AS _row_count, {', '.join(select_parts)} "
            f"FROM ({base_sql}) AS _dexaz_report_src"
        )
        result = adapter.execute_query(
            sql, timeout_seconds=settings.dbx_query_timeout_seconds, max_rows=1
        )
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["error"])

        row = result["rows"][0] if result["rows"] else {}
        totals = [
            {
                "column": col,
                "sum": row.get(f"{col}__sum"),
                "avg": row.get(f"{col}__avg"),
                "min": row.get(f"{col}__min"),
                "max": row.get(f"{col}__max"),
            }
            for col in columns
        ]
        return {
            "source": source_label,
            "mode": "totals",
            "row_count": row.get("_row_count", 0),
            "totals": totals,
        }

    if mode == "grouped":
        group_by = payload.get("group_by")
        value_column = payload.get("value_column")
        agg = str(payload.get("agg") or ("sum" if value_column else "count")).lower()
        if agg not in _ALLOWED_AGG:
            raise HTTPException(status_code=400, detail="Fungsi agregasi tidak valid")
        if not group_by:
            raise HTTPException(status_code=400, detail="Pilih kolom untuk pengelompokan")

        # `all=true` means "don't cap this — show every group", bounded
        # only by the app's general query safety ceiling (the same one
        # /table-summary samples against), not an arbitrary UI limit.
        # Otherwise the user-chosen limit is honored as-is (still bounded
        # by that same ceiling so a mistyped huge number can't blow up the
        # query) — no more hardcoded "top 30/50" cap.
        show_all = bool(payload.get("all"))
        max_allowed = settings.dbx_max_rows_returned
        if show_all:
            limit = max_allowed
        else:
            try:
                limit = min(max(int(payload.get("limit") or 15), 1), max_allowed)
            except (TypeError, ValueError):
                limit = 15

        # Sort order for the grouped rows: by the aggregated value (highest
        # or lowest first) or by the group-by column itself (oldest/newest
        # first — the natural choice when group_by is a date/time column,
        # but works as A→Z / Z→A for any other column too). Whatever the
        # LIMIT/`all` above decided still applies on top of this ordering.
        sort = payload.get("sort") or "value_desc"
        sort_sql = {
            "value_desc": "_value DESC",
            "value_asc": "_value ASC",
            "label_asc": "_label ASC",
            "label_desc": "_label DESC",
        }.get(sort)
        if not sort_sql:
            raise HTTPException(status_code=400, detail="Urutan tidak valid")

        g = _quote_ident(group_by, db_type)
        if agg == "count":
            value_expr = "COUNT(*)"
        else:
            if not value_column:
                raise HTTPException(
                    status_code=400, detail="Pilih kolom nilai untuk fungsi agregasi ini"
                )
            value_expr = f"{agg.upper()}({_numeric_cast(_quote_ident(value_column, db_type), db_type)})"

        sql = (
            f"SELECT {g} AS _label, {value_expr} AS _value "
            f"FROM ({base_sql}) AS _dexaz_report_src "
            f"WHERE {g} IS NOT NULL "
            f"GROUP BY {g} ORDER BY {sort_sql} LIMIT {limit}"
        )
        result = adapter.execute_query(
            sql, timeout_seconds=settings.dbx_query_timeout_seconds, max_rows=limit
        )
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["error"])

        labels: list[str] = []
        values: list[float] = []
        for r in result["rows"]:
            labels.append(str(r.get("_label")))
            v = r.get("_value")
            values.append(float(v) if v is not None else 0.0)

        grand_total = None
        if agg in ("sum", "count"):
            gt_expr = (
                "COUNT(*)"
                if agg == "count"
                else f"SUM({_numeric_cast(_quote_ident(value_column, db_type), db_type)})"
            )
            gt_sql = f"SELECT {gt_expr} AS _gt FROM ({base_sql}) AS _dexaz_report_src"
            gt_result = adapter.execute_query(
                gt_sql, timeout_seconds=settings.dbx_query_timeout_seconds, max_rows=1
            )
            if gt_result["success"] and gt_result["rows"]:
                gt = gt_result["rows"][0].get("_gt")
                grand_total = float(gt) if gt is not None else None

        return {
            "source": source_label,
            "mode": "grouped",
            "group_by": group_by,
            "value_column": value_column,
            "agg": agg,
            "labels": labels,
            "values": values,
            "grand_total": grand_total,
            "truncated": len(labels) >= limit,
        }

    raise HTTPException(status_code=400, detail="mode harus 'totals' atau 'grouped'")


@router.post("/column-values")
def column_values(
    payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """Full breakdown of every distinct value in one column, for the
    "Lihat semua" expansion on a Ringkasan Tabel card — unlike the top-5
    baked into /table-summary's profiling (which only looks at the bounded
    sample), this runs a GROUP BY over the *entire* source so the counts
    and ranking are exact even for a sampled table.
    """
    adapter, base_sql, source_label, db_type = _resolve_source(payload, db)

    column = payload.get("column")
    if not column:
        raise HTTPException(status_code=400, detail="Kolom wajib diisi")
    c = _quote_ident(column, db_type)

    try:
        limit = min(max(int(payload.get("limit") or 200), 1), 1000)
    except (TypeError, ValueError):
        limit = 200

    sql = (
        f"SELECT {c} AS _label, COUNT(*) AS _value "
        f"FROM ({base_sql}) AS _dexaz_colvals_src "
        f"WHERE {c} IS NOT NULL "
        f"GROUP BY {c} ORDER BY _value DESC, _label ASC LIMIT {limit}"
    )
    result = adapter.execute_query(
        sql, timeout_seconds=settings.dbx_query_timeout_seconds, max_rows=limit
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    values = [{"value": str(r.get("_label")), "count": r.get("_value")} for r in result["rows"]]

    distinct_sql = f"SELECT COUNT(DISTINCT {c}) AS _dc FROM ({base_sql}) AS _dexaz_colvals_src"
    distinct_result = adapter.execute_query(
        distinct_sql, timeout_seconds=settings.dbx_query_timeout_seconds, max_rows=1
    )
    total_distinct = None
    if distinct_result["success"] and distinct_result["rows"]:
        total_distinct = distinct_result["rows"][0].get("_dc")

    return {
        "source": source_label,
        "column": column,
        "values": values,
        "total_distinct": total_distinct,
        "truncated": total_distinct is not None and total_distinct > len(values),
    }
