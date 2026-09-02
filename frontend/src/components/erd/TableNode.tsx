"use client";

import { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { KeyRound, Link2, Table2 } from "lucide-react";
import type { ErdColumn } from "@/lib/api";

export interface TableNodeData {
  tableName: string;
  columns: ErdColumn[];
  fkColumns: Set<string>;
  columnCount: number;
  [key: string]: unknown;
}

function TableNodeImpl({ data, selected }: NodeProps) {
  const d = data as unknown as TableNodeData;
  return (
    <div
      className={`dbx-glass-strong rounded-xl overflow-hidden w-[260px] ${
        selected ? "ring-1 ring-cyan" : ""
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-panel-2 border-b border-border-glass">
        <Table2 size={13} className="text-cyan shrink-0" />
        <span className="font-mono text-xs text-text truncate">{d.tableName}</span>
      </div>
      <div>
        {d.columns.map((col) => {
          const isFk = d.fkColumns.has(col.name);
          const handleId = `${d.tableName}.${col.name}`;
          return (
            <div
              key={col.name}
              className="dbx-erd-row group relative flex items-center gap-1.5 px-3 py-1.5 text-[11px] border-b border-border-glass/40 last:border-0 hover:bg-panel/40"
            >
              <Handle
                type="target"
                position={Position.Left}
                id={handleId}
                title={`Tarik ke sini untuk hubungkan ke ${d.tableName}.${col.name}`}
                className="!w-3 !h-3 !bg-cyan !border-2 !border-void transition-transform group-hover:!scale-125"
                style={{ left: -6 }}
              />
              {col.is_primary_key ? (
                <KeyRound size={10} className="text-cyan shrink-0" />
              ) : isFk ? (
                <Link2 size={10} className="text-violet shrink-0" />
              ) : (
                <span className="w-2.5 shrink-0" />
              )}
              <span className="font-mono text-text truncate flex-1">{col.name}</span>
              <span className="text-text-faint truncate max-w-[70px] shrink-0">{col.type}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={handleId}
                title={`Tarik dari ${d.tableName}.${col.name} ke kolom lain untuk buat relasi`}
                className="!w-3 !h-3 !bg-violet !border-2 !border-void transition-transform group-hover:!scale-125"
                style={{ right: -6 }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeImpl);
