"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Table2, Eye, RefreshCw, Search } from "lucide-react";
import { SchemaTree } from "@/lib/api";

export interface SelectedTable {
  schema: string;
  table: string;
  kind: "table" | "view";
}

export function DatabaseExplorerTree({
  tree,
  loading,
  onSelect,
  onRefresh,
  selected,
}: {
  tree: SchemaTree | null;
  loading: boolean;
  onSelect: (t: SelectedTable) => void;
  onRefresh: () => void;
  selected: SelectedTable | null;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  function toggle(key: string) {
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  }

  const q = search.trim().toLowerCase();

  return (
    <div className="w-64 shrink-0 border-r border-border-glass dbx-glass flex flex-col h-full">
      <div className="p-3 border-b border-border-glass">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari tabel…"
            className="w-full bg-void-2 border border-border-glass rounded-lg pl-8 pr-2 py-1.5 text-xs text-text placeholder:text-text-faint focus:outline-none focus:border-cyan/50"
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-wide text-text-faint">
        <span>Database</span>
        <button onClick={onRefresh} title="Refresh metadata" className="hover:text-cyan transition-colors">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-auto dbx-scrollbar px-2 pb-3">
        {!tree ? (
          <p className="text-xs text-text-faint px-2 py-4">Pilih koneksi untuk melihat schema.</p>
        ) : tree.schemas.length === 0 ? (
          <p className="text-xs text-text-faint px-2 py-4">Tidak ada schema ditemukan.</p>
        ) : (
          tree.schemas.map((s) => {
            const schemaKey = `schema:${s.schema}`;
            const isOpen = expanded[schemaKey] ?? true;
            const filteredTables = s.tables.filter((t) => !q || t.name.toLowerCase().includes(q));
            const filteredViews = s.views.filter((v) => !q || v.name.toLowerCase().includes(q));
            if (q && filteredTables.length === 0 && filteredViews.length === 0) return null;

            return (
              <div key={s.schema} className="mb-1">
                <button
                  onClick={() => toggle(schemaKey)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-text hover:bg-panel/50 rounded-md transition-colors"
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="truncate">{s.schema}</span>
                  <span className="ml-auto text-text-faint font-mono">{s.tables.length}</span>
                </button>

                {isOpen && (
                  <div className="ml-3 pl-2 border-l border-border-glass">
                    {filteredTables.map((t) => {
                      const isSelected =
                        selected?.schema === s.schema && selected.table === t.name && selected.kind === "table";
                      return (
                        <button
                          key={t.name}
                          onClick={() => onSelect({ schema: s.schema, table: t.name, kind: "table" })}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                            isSelected
                              ? "bg-panel-2 text-cyan border border-border-glass-strong"
                              : "text-text-muted hover:text-text hover:bg-panel/40"
                          }`}
                        >
                          <Table2 size={12} className="shrink-0" />
                          <span className="truncate">{t.name}</span>
                        </button>
                      );
                    })}
                    {filteredViews.map((v) => {
                      const isSelected =
                        selected?.schema === s.schema && selected.table === v.name && selected.kind === "view";
                      return (
                        <button
                          key={v.name}
                          onClick={() => onSelect({ schema: s.schema, table: v.name, kind: "view" })}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                            isSelected
                              ? "bg-panel-2 text-violet border border-border-glass-strong"
                              : "text-text-muted hover:text-text hover:bg-panel/40"
                          }`}
                        >
                          <Eye size={12} className="shrink-0" />
                          <span className="truncate">{v.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
