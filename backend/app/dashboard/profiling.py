"""
Per-column data profiling used by the Dashboard's "Ringkasan Tabel" widget.

Deliberately database-agnostic: it profiles whatever rows/columns it's
given, so the same function works whether those rows came from a real
table (`SELECT * FROM schema.table`) or from an arbitrary saved query
built in the Query Builder — the caller (app/api/dashboard.py) is the one
that decides what SQL to run and wraps it in a bounded sample.
"""
from collections import Counter
from datetime import date, datetime
from typing import Any


def _is_numeric(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_temporal(v: Any) -> bool:
    return isinstance(v, (datetime, date))


def _hashable(v: Any) -> Any:
    if isinstance(v, (list, dict)):
        return str(v)
    return v


def profile_columns(columns: list[str], rows: list[dict]) -> list[dict]:
    """Returns one profile entry per column: null count, distinct count,
    and (depending on the detected kind) numeric min/max/avg, a temporal
    min/max, or the top-5 most frequent text values."""
    n = len(rows)
    profiles = []

    for col in columns:
        values = [r.get(col) for r in rows]
        non_null = [v for v in values if v is not None]
        null_count = n - len(non_null)

        entry: dict[str, Any] = {
            "column": col,
            "null_count": null_count,
            "null_pct": round(null_count / n * 100, 1) if n else 0.0,
            "distinct_count": len({_hashable(v) for v in non_null}),
        }

        if non_null and all(_is_numeric(v) for v in non_null):
            nums = [float(v) for v in non_null]
            entry["kind"] = "numeric"
            entry["min"] = min(nums)
            entry["max"] = max(nums)
            entry["avg"] = round(sum(nums) / len(nums), 4)
        elif non_null and all(_is_temporal(v) for v in non_null):
            entry["kind"] = "temporal"
            entry["min"] = min(non_null).isoformat()
            entry["max"] = max(non_null).isoformat()
        else:
            entry["kind"] = "text"
            top = Counter(str(v) for v in non_null).most_common(5)
            entry["top_values"] = [{"value": v, "count": c} for v, c in top]

        profiles.append(entry)

    return profiles
