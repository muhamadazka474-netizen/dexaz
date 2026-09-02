"""
Introspection engine (spec section 45).

Flow: connection -> get_schemas -> for each schema: get_tables, get_views,
get_functions, get_sequences -> cache.

Metadata is cached in memory per connection_id to keep the explorer fast
on repeated loads; the "Refresh Metadata" action clears the cache entry
so the next read re-introspects from the live database.

This is a simple process-local cache appropriate for a single-user local
tool. It intentionally does not hard-code anything about a specific
database's structure — it just stores whatever introspection returned.
"""
import time
from typing import Any

from app.adapters.base import DatabaseAdapter

_CACHE: dict[str, dict[str, Any]] = {}
_CACHE_TTL_SECONDS = 60


def _cache_key(connection_id: str, database: str | None = None) -> str:
    return f"{connection_id}::{database}" if database else connection_id


def get_metadata_tree(
    connection_id: str, adapter: DatabaseAdapter, force_refresh: bool = False, database: str | None = None
) -> dict[str, Any]:
    key = _cache_key(connection_id, database)
    cached = _CACHE.get(key)
    if cached and not force_refresh and (time.time() - cached["_cached_at"]) < _CACHE_TTL_SECONDS:
        return cached["data"]

    schemas = adapter.get_schemas()
    tree = []
    for s in schemas:
        schema_name = s["name"]
        tables = adapter.get_tables(schema_name)
        views = adapter.get_views(schema_name)
        try:
            functions = adapter.get_functions(schema_name)
        except Exception:
            functions = []
        try:
            sequences = adapter.get_sequences(schema_name)
        except Exception:
            sequences = []
        tree.append({
            "schema": schema_name,
            "tables": tables,
            "views": views,
            "functions": functions,
            "sequences": sequences,
        })

    data = {"schemas": tree}
    _CACHE[key] = {"data": data, "_cached_at": time.time()}
    return data


def invalidate(connection_id: str, database: str | None = None) -> None:
    if database:
        _CACHE.pop(_cache_key(connection_id, database), None)
    else:
        # No specific database given: drop every cached entry for this
        # connection (all databases), since e.g. the connection's
        # credentials/host just changed.
        for key in [k for k in _CACHE if k == connection_id or k.startswith(f"{connection_id}::")]:
            _CACHE.pop(key, None)
