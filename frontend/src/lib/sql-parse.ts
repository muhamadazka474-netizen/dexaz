/**
 * Very lightweight SQL scanning — not a real parser. Good enough to find
 * "FROM x" / "JOIN y [AS] alias" references so the editor can offer
 * table/alias-aware column autocomplete without a full SQL grammar.
 */
export interface ParsedTableRef {
  schema?: string;
  table: string;
  alias?: string;
}

// An identifier is either bare (customers) or double-quoted ("Customers",
// "weird name"). The Query Builder always emits quoted identifiers (e.g.
// `FROM "public"."customers"`), so matching bare identifiers only would
// never find a table reference for anything it generates — silently
// disabling column suggestions for that whole flow.
const IDENT = `(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)`;
const TABLE_REF_RE = new RegExp(
  `\\b(?:FROM|JOIN)\\s+(${IDENT}(?:\\s*\\.\\s*${IDENT})?)(?:\\s+(?:AS\\s+)?(${IDENT}))?`,
  "gi"
);

const SQL_KEYWORDS_EXCLUDED_AS_ALIAS = new Set([
  "WHERE", "GROUP", "ORDER", "LIMIT", "HAVING", "ON", "INNER", "LEFT",
  "RIGHT", "FULL", "OUTER", "JOIN", "UNION", "SET", "VALUES", "RETURNING",
]);

function unquote(ident: string): string {
  return ident.startsWith('"') && ident.endsWith('"') ? ident.slice(1, -1) : ident;
}

// Splits a possibly-quoted "schema.table" reference into its parts without
// getting tripped up by a literal "." that might appear inside a quoted
// identifier.
function splitQualifiedIdent(raw: string): string[] {
  const parts = raw.match(/"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [raw];
  return parts.map(unquote);
}

export function parseTableRefs(sql: string): ParsedTableRef[] {
  const refs: ParsedTableRef[] = [];
  let match: RegExpExecArray | null;
  TABLE_REF_RE.lastIndex = 0;
  while ((match = TABLE_REF_RE.exec(sql)) !== null) {
    const raw = match[1];
    const rawAlias = match[2];
    let alias: string | undefined = rawAlias ? unquote(rawAlias) : undefined;
    // Only bare-word aliases can accidentally be a keyword (WHERE, ON, ...);
    // a quoted alias is unambiguous, so never filter it out.
    if (alias && !rawAlias!.startsWith('"') && SQL_KEYWORDS_EXCLUDED_AS_ALIAS.has(alias.toUpperCase())) {
      alias = undefined;
    }
    const parts = splitQualifiedIdent(raw);
    if (parts.length === 2) {
      refs.push({ schema: parts[0], table: parts[1], alias });
    } else {
      refs.push({ table: parts[0], alias });
    }
  }
  return refs;
}

export const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "IS", "NULL",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE",
  "ALTER", "DROP", "TRUNCATE", "INDEX", "UNIQUE", "PRIMARY", "KEY",
  "FOREIGN", "REFERENCES", "CONSTRAINT", "DEFAULT", "JOIN", "INNER",
  "LEFT", "RIGHT", "FULL", "OUTER", "ON", "GROUP", "BY", "ORDER", "ASC",
  "DESC", "HAVING", "LIMIT", "OFFSET", "AS", "DISTINCT", "COUNT", "SUM",
  "AVG", "MIN", "MAX", "CASE", "WHEN", "THEN", "ELSE", "END", "WITH",
  "UNION", "ALL", "EXISTS", "BETWEEN", "LIKE", "ILIKE", "RETURNING",
  "EXPLAIN", "ANALYZE", "CAST", "COALESCE",
];
