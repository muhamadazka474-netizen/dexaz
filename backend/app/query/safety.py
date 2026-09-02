"""
Lightweight SQL safety checks. This is NOT a full SQL parser — it's a
pragmatic guard that flags statements the UI should ask the user to
confirm before running (per spec section 20). The actual database still
enforces real constraints; this just prevents accidental fat-finger
data loss from the SQL Editor.
"""
import re

DESTRUCTIVE_NO_WHERE_RE = {
    "DELETE": re.compile(r"^\s*DELETE\s+FROM\s+\S+\s*(?:;|\Z)", re.IGNORECASE),
    "UPDATE": re.compile(r"^\s*UPDATE\s+\S+\s+SET\s+.+?(?:;|\Z)", re.IGNORECASE),
}
DDL_RE = re.compile(r"^\s*(DROP|TRUNCATE)\s+", re.IGNORECASE)


def needs_confirmation(sql_text: str) -> tuple[bool, str | None]:
    stripped = sql_text.strip()
    upper = stripped.upper()

    if DDL_RE.match(stripped):
        keyword = upper.split()[0]
        return True, f"This will run a {keyword} statement, which can permanently remove data or structure."

    if upper.startswith("DELETE") and "WHERE" not in upper:
        return True, "This DELETE has no WHERE clause — it will remove every row in the table."

    if upper.startswith("UPDATE") and "WHERE" not in upper:
        return True, "This UPDATE has no WHERE clause — it will modify every row in the table."

    if upper.startswith("DELETE") or upper.startswith("UPDATE"):
        return True, "This operation may permanently modify data."

    return False, None
