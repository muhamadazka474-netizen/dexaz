import type { ErdData, ErdColumn } from "./api";

export interface SuggestedRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  reason: string;
}

function singularize(s: string): string {
  const lower = s.toLowerCase();
  if (lower.endsWith("ies")) return lower.slice(0, -3) + "y";
  if (lower.endsWith("ses") || lower.endsWith("xes") || lower.endsWith("ches")) return lower.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1);
  return lower;
}

function normalizeType(t: string): string {
  return t.toLowerCase().replace(/\(.*\)/, "").trim();
}

const INT_TYPES = new Set(["integer", "int", "int4", "bigint", "int8", "smallint", "int2", "serial", "bigserial", "smallserial"]);
const STR_TYPES = ["character varying", "varchar", "text", "char", "character"];

function typesCompatible(a: string, b: string): boolean {
  const na = normalizeType(a);
  const nb = normalizeType(b);
  if (na === nb) return true;
  if (INT_TYPES.has(na) && INT_TYPES.has(nb)) return true;
  if (STR_TYPES.some((s) => na.includes(s)) && STR_TYPES.some((s) => nb.includes(s))) return true;
  if (na === "uuid" && nb === "uuid") return true;
  return false;
}

function pkColumn(columns: ErdColumn[]): ErdColumn | undefined {
  return columns.find((c) => c.is_primary_key) ?? columns.find((c) => c.name.toLowerCase() === "id");
}

/**
 * Suggests likely foreign-key relationships between tables that aren't
 * already linked, similar to how MS Access proposes relationships based
 * on matching field names. Two passes:
 *   1. Convention match: a column named "<table>_id" (singular or plural)
 *      pointing at another table's primary key — highest confidence.
 *   2. Same-name match: two tables share a non-generic column name with
 *      compatible types and at least one side is unique/primary — lower
 *      confidence, still surfaced for the user to confirm.
 */
export function suggestRelationships(erd: ErdData): SuggestedRelation[] {
  const existingPairs = new Set<string>();
  for (const t of erd.tables) {
    for (const fk of t.foreign_keys) {
      existingPairs.add([t.name, fk.column, fk.referenced_table, fk.referenced_column].sort().join("|"));
    }
  }

  const suggestions: SuggestedRelation[] = [];
  const claimedColumns = new Set<string>(); // `${table}.${column}` already used as the "from" side

  // --- Pass 1: naming convention (orders.customer_id -> customers.id) ---
  for (const t1 of erd.tables) {
    for (const c1 of t1.columns) {
      const m = /^(.+?)_id$/i.exec(c1.name);
      if (!m) continue;
      const base = m[1].toLowerCase();
      const target = erd.tables.find((t2) => {
        if (t2.name === t1.name) return false;
        const tn = t2.name.toLowerCase();
        return tn === base || singularize(tn) === base || tn === base + "s";
      });
      if (!target) continue;
      const pk = pkColumn(target.columns);
      if (!pk) continue;
      if (!typesCompatible(c1.type, pk.type)) continue;
      const pairKey = [t1.name, c1.name, target.name, pk.name].sort().join("|");
      if (existingPairs.has(pairKey)) continue;
      const fromKey = `${t1.name}.${c1.name}`;
      if (claimedColumns.has(fromKey)) continue;
      claimedColumns.add(fromKey);
      existingPairs.add(pairKey);
      suggestions.push({
        fromTable: t1.name,
        fromColumn: c1.name,
        toTable: target.name,
        toColumn: pk.name,
        reason: `"${c1.name}" mengikuti konvensi nama tabel "${target.name}"`,
      });
    }
  }

  // --- Pass 2: exact same non-generic column name across tables ---
  const seenPairs = new Set<string>();
  for (let i = 0; i < erd.tables.length; i++) {
    for (let j = i + 1; j < erd.tables.length; j++) {
      const t1 = erd.tables[i];
      const t2 = erd.tables[j];
      for (const c1 of t1.columns) {
        if (c1.name.toLowerCase() === "id") continue; // too generic on its own
        for (const c2 of t2.columns) {
          if (c1.name.toLowerCase() !== c2.name.toLowerCase()) continue;
          if (!typesCompatible(c1.type, c2.type)) continue;
          if (!c1.is_primary_key && !c1.is_unique && !c2.is_primary_key && !c2.is_unique) continue;
          const pairKey = [t1.name, c1.name, t2.name, c2.name].sort().join("|");
          if (existingPairs.has(pairKey) || seenPairs.has(pairKey)) continue;
          if (claimedColumns.has(`${t1.name}.${c1.name}`) || claimedColumns.has(`${t2.name}.${c2.name}`)) continue;
          seenPairs.add(pairKey);
          const targetIsPk = c2.is_primary_key || c2.is_unique;
          suggestions.push({
            fromTable: targetIsPk ? t1.name : t2.name,
            fromColumn: targetIsPk ? c1.name : c2.name,
            toTable: targetIsPk ? t2.name : t1.name,
            toColumn: targetIsPk ? c2.name : c1.name,
            reason: `kolom "${c1.name}" bernama sama di kedua tabel`,
          });
        }
      }
    }
  }

  return suggestions;
}
