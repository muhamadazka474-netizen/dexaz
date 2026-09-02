import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditorNS, Position as MonacoPosition } from "monaco-editor";
import type { MutableRefObject } from "react";
import { api, SchemaTree } from "@/lib/api";
import { parseTableRefs, SQL_KEYWORDS } from "@/lib/sql-parse";
import { SQL_KEYWORD_GROUPS, SqlKeywordItem } from "@/lib/sql-keywords";

/**
 * Curated multi-tabstop snippets for the clauses people mistype most often
 * (WHERE, JOIN, INSERT, UPDATE, ...). Typing e.g. "where" now suggests a
 * complete, ready-to-fill fragment — `WHERE column = value` — with each
 * placeholder selected in turn via Tab, instead of only the bare keyword.
 * Anything not listed here falls back to `autoSnippet`, which still wraps
 * the catalog's example insertText as one editable tabstop.
 */
const CURATED_SNIPPETS: Record<string, string> = {
  SELECT: "SELECT ${1:*}",
  FROM: "\nFROM ${1:schema}.${2:table_name}",
  WHERE: "\nWHERE ${1:column} ${2:=} ${3:value}",
  AND: " AND ${1:column} ${2:=} ${3:value}",
  OR: " OR ${1:column} ${2:=} ${3:value}",
  NOT: "NOT ${1:condition}",
  IN: "IN (${1:value1}, ${2:value2})",
  "NOT IN": "NOT IN (${1:value1}, ${2:value2})",
  BETWEEN: "BETWEEN ${1:value1} AND ${2:value2}",
  "NOT BETWEEN": "NOT BETWEEN ${1:value1} AND ${2:value2}",
  LIKE: "LIKE '%${1:kata}%'",
  ILIKE: "ILIKE '%${1:kata}%'",
  "IS NULL": "IS NULL",
  "IS NOT NULL": "IS NOT NULL",
  "ORDER BY": "\nORDER BY ${1:column} ${2:ASC}",
  "GROUP BY": "\nGROUP BY ${1:column}",
  HAVING: "\nHAVING COUNT(*) ${1:>} ${2:1}",
  LIMIT: "\nLIMIT ${1:100}",
  OFFSET: "\nOFFSET ${1:0}",
  DISTINCT: "DISTINCT ",
  AS: "AS ${1:alias}",
  "INNER JOIN": "\nINNER JOIN ${1:schema}.${2:other_table} ON ${3:table}.${4:id} = ${2:other_table}.${5:table_id}",
  "LEFT JOIN": "\nLEFT JOIN ${1:schema}.${2:other_table} ON ${3:table}.${4:id} = ${2:other_table}.${5:table_id}",
  "RIGHT JOIN": "\nRIGHT JOIN ${1:schema}.${2:other_table} ON ${3:table}.${4:id} = ${2:other_table}.${5:table_id}",
  "FULL OUTER JOIN": "\nFULL OUTER JOIN ${1:schema}.${2:other_table} ON ${3:table}.${4:id} = ${2:other_table}.${5:table_id}",
  "CROSS JOIN": "\nCROSS JOIN ${1:schema}.${2:other_table}",
  CASE: "CASE WHEN ${1:condition} THEN ${2:'A'} ELSE ${3:'B'} END",
  "COALESCE()": "COALESCE(${1:column}, ${2:'default'})",
  "NULLIF()": "NULLIF(${1:a}, ${2:b})",
  EXISTS: "EXISTS (SELECT 1 FROM ${1:other_table} WHERE ${2:condition})",
  "NOT EXISTS": "NOT EXISTS (SELECT 1 FROM ${1:other_table} WHERE ${2:condition})",
  "INSERT INTO": "INSERT INTO ${1:schema}.${2:table_name} (${3:column1}, ${4:column2}) VALUES (${5:'nilai1'}, ${6:'nilai2'})",
  UPDATE: "UPDATE ${1:schema}.${2:table_name} SET ${3:column} = ${4:'nilai baru'} WHERE ${5:id} = ${6:1}",
  DELETE: "DELETE FROM ${1:schema}.${2:table_name} WHERE ${3:id} = ${4:1}",
  "CREATE TABLE": "CREATE TABLE ${1:schema}.${2:new_table} (\n  ${3:id} SERIAL PRIMARY KEY\n)",
  "ALTER TABLE": "ALTER TABLE ${1:schema}.${2:table_name} ADD COLUMN ${3:new_column} ${4:TEXT}",
  "CAST()": "CAST(${1:column} AS ${2:INTEGER})",
  "COUNT()": "COUNT(${1:*})",
};

/** Escapes text so it's safe to drop verbatim inside a single LSP snippet tabstop. */
function escapeSnippetText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/}/g, "\\}");
}

function autoSnippet(item: SqlKeywordItem): string {
  return `\${1:${escapeSnippetText(item.insertText)}}`;
}

/** Full snippet text (Monaco/LSP snippet syntax) for a keyword-catalog entry. */
export function snippetInsertText(item: SqlKeywordItem): string {
  return CURATED_SNIPPETS[item.token] ?? autoSnippet(item);
}

export interface SqlCompletionRefs {
  treeRef: MutableRefObject<SchemaTree | null>;
  activeConnIdRef: MutableRefObject<string | null>;
  columnCacheRef: MutableRefObject<Record<string, { name: string; type: string }[]>>;
}

/**
 * When a query references a table without qualifying its schema (e.g.
 * `FROM customers` instead of `FROM public.customers`, which is how most
 * people actually write SQL), find the schema that really contains that
 * table/view instead of blindly guessing the first schema in the tree —
 * a wrong guess 404s on the column-fetch API and gets cached as "no
 * columns" for the rest of the session.
 */
function resolveSchemaForTable(tree: SchemaTree, tableName: string, explicitSchema?: string): string {
  if (explicitSchema) return explicitSchema;
  const lowerName = tableName.toLowerCase();
  for (const s of tree.schemas) {
    if (
      s.tables.some((t) => t.name.toLowerCase() === lowerName) ||
      s.views.some((v) => v.name.toLowerCase() === lowerName)
    ) {
      return s.schema;
    }
  }
  return tree.schemas[0]?.schema ?? "public";
}

/**
 * Registers a "sql" language completion provider on the given Monaco
 * instance. Shared by the SQL Editor and the Query Builder's manual SQL
 * box so both offer the same complete, hard-to-typo suggestions:
 *  - full clause/function snippets from the keyword catalog (tab through
 *    table/column/value placeholders instead of hand-typing syntax)
 *  - real table & view names from the connected schema
 *  - real column names for tables/aliases already referenced in the query
 */
export function registerSqlCompletionProvider(monacoInstance: Monaco, refs: SqlCompletionRefs) {
  return monacoInstance.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " "],
    provideCompletionItems: async (model: MonacoEditorNS.ITextModel, position: MonacoPosition) => {
      const textUntilCursor = model.getValue();
      const currentTree = refs.treeRef.current;
      const suggestions: import("monaco-editor").languages.CompletionItem[] = [];

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      // Full clause/function snippets — curated ones (WHERE, JOIN, INSERT,
      // ...) are ranked above the plain auto-wrapped fallback so the most
      // useful template wins when several tokens share a prefix.
      const seenTokens = new Set<string>();
      for (const group of SQL_KEYWORD_GROUPS) {
        for (const item of group.items) {
          if (seenTokens.has(item.token)) continue;
          seenTokens.add(item.token);
          const curated = Boolean(CURATED_SNIPPETS[item.token]);
          suggestions.push({
            label: item.token,
            kind: monacoInstance.languages.CompletionItemKind.Snippet,
            insertText: snippetInsertText(item),
            insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: group.label,
            documentation: {
              value: `${item.description}\n\n\`\`\`sql\n${item.example}\n\`\`\``,
            },
            sortText: `${curated ? "2" : "4"}_${item.token}`,
            range,
          });
        }
      }

      // Bare keywords not covered by the catalog above (transaction/DDL
      // odds and ends, JOIN/ON, etc.) — still handy as plain completions.
      for (const kw of SQL_KEYWORDS) {
        if (seenTokens.has(kw)) continue;
        suggestions.push({
          label: kw,
          kind: monacoInstance.languages.CompletionItemKind.Keyword,
          insertText: kw,
          sortText: `3_${kw}`,
          range,
        });
      }

      // Table/view names from the schema tree.
      if (currentTree) {
        for (const s of currentTree.schemas) {
          for (const t of s.tables) {
            suggestions.push({
              label: t.name,
              detail: `table · ${s.schema}`,
              kind: monacoInstance.languages.CompletionItemKind.Class,
              insertText: t.name,
              sortText: `1_${t.name}`,
              range,
            });
          }
          for (const v of s.views) {
            suggestions.push({
              label: v.name,
              detail: `view · ${s.schema}`,
              kind: monacoInstance.languages.CompletionItemKind.Interface,
              insertText: v.name,
              sortText: `1_${v.name}`,
              range,
            });
          }
        }
      }

      // Column suggestions for tables/aliases already referenced in this
      // query — ranked highest, since a real column name is exactly what
      // avoids a typo'd WHERE/SELECT/ORDER BY target.
      const connId = refs.activeConnIdRef.current;
      if (connId && currentTree) {
        const refsFound = parseTableRefs(textUntilCursor);
        for (const ref of refsFound) {
          const schema = resolveSchemaForTable(currentTree, ref.table, ref.schema);
          const cacheKey = `${connId}:${schema}.${ref.table}`;
          if (!refs.columnCacheRef.current[cacheKey]) {
            try {
              const structure = await api.getTableStructure(connId, schema, ref.table);
              refs.columnCacheRef.current[cacheKey] = structure.columns.map((c) => ({
                name: c.name,
                type: c.type,
              }));
            } catch {
              refs.columnCacheRef.current[cacheKey] = [];
            }
          }
          const cols = refs.columnCacheRef.current[cacheKey] ?? [];
          const prefix = ref.alias ?? ref.table;
          for (const col of cols) {
            suggestions.push({
              label: `${prefix}.${col.name}`,
              detail: col.type,
              kind: monacoInstance.languages.CompletionItemKind.Field,
              insertText: `${prefix}.${col.name}`,
              sortText: `0_${prefix}.${col.name}`,
              range,
            });
            suggestions.push({
              label: col.name,
              detail: `${col.type} · ${ref.table}`,
              kind: monacoInstance.languages.CompletionItemKind.Field,
              insertText: col.name,
              sortText: `0_${col.name}`,
              range,
            });
          }
        }
      }

      return { suggestions };
    },
  });
}
