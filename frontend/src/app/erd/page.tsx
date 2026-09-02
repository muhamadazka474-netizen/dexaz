"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Connection,
  Edge,
  Node,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, Plug, RefreshCw, LayoutGrid, Loader2, Sparkles, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TableNode, TableNodeData } from "@/components/erd/TableNode";
import {
  RelationshipModal,
  CreateRelationshipPayload,
  DeleteRelationshipPayload,
} from "@/components/erd/RelationshipModal";
import { layoutErdGraph, resolveErdLayout, saveLayout } from "@/lib/erd-layout";
import { suggestRelationships, SuggestedRelation } from "@/lib/erd-suggest";
import { api, Connection as DbConnection, SchemaTree, ErdData } from "@/lib/api";

const nodeTypes = { table: TableNode };

// Foreign-key DDL is *not* portable across engines the way a SELECT is
// (identifier quoting differs, MySQL/MariaDB drop a FK with DROP FOREIGN
// KEY rather than DROP CONSTRAINT, and SQLite has no ALTER TABLE ADD/DROP
// CONSTRAINT at all — a foreign key can only be defined at CREATE TABLE
// time). Rather than build DDL here and hope it runs, the actual change
// is executed by the backend (POST .../erd/relationships), which knows
// how to do this correctly per engine — including rebuilding the table
// for SQLite. These functions only build a human-readable preview.
function qi(name: string, dbType: string | undefined): string {
  if (dbType === "mysql" || dbType === "mariadb") {
    return "`" + String(name).replace(/`/g, "``") + "`";
  }
  return `"${String(name).replace(/"/g, '""')}"`;
}

function qualified(schemaName: string, tableName: string, dbType: string | undefined): string {
  return `${qi(schemaName, dbType)}.${qi(tableName, dbType)}`;
}

function previewAddFk(
  dbType: string | undefined,
  schemaName: string,
  fromTable: string,
  fromColumn: string,
  toTable: string,
  toColumn: string,
  constraintName: string
): string {
  if (dbType === "sqlite") {
    return (
      `-- SQLite tidak punya ALTER TABLE ADD CONSTRAINT, jadi tabel "${fromTable}" akan\n` +
      `-- dibangun ulang dengan foreign key ini disertakan. Data yang ada disalin\n` +
      `-- otomatis oleh backend — tidak ada yang hilang.\n` +
      `${fromTable}.${fromColumn} → ${toTable}.${toColumn}`
    );
  }
  return (
    `ALTER TABLE ${qualified(schemaName, fromTable, dbType)} ` +
    `ADD CONSTRAINT ${qi(constraintName, dbType)} FOREIGN KEY (${qi(fromColumn, dbType)}) ` +
    `REFERENCES ${qualified(schemaName, toTable, dbType)} (${qi(toColumn, dbType)});`
  );
}

function previewDropFk(
  dbType: string | undefined,
  schemaName: string,
  fromTable: string,
  constraintName: string
): string {
  if (dbType === "sqlite") {
    return (
      `-- SQLite tidak punya ALTER TABLE DROP CONSTRAINT, jadi tabel "${fromTable}" akan\n` +
      `-- dibangun ulang tanpa foreign key ini. Data yang ada disalin otomatis oleh\n` +
      `-- backend — tidak ada yang hilang.\n` +
      `constraint: ${constraintName}`
    );
  }
  if (dbType === "mysql" || dbType === "mariadb") {
    return `ALTER TABLE ${qualified(schemaName, fromTable, dbType)} DROP FOREIGN KEY ${qi(constraintName, dbType)};`;
  }
  return `ALTER TABLE ${qualified(schemaName, fromTable, dbType)} DROP CONSTRAINT ${qi(constraintName, dbType)};`;
}

function buildGraph(erd: ErdData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = erd.tables.map((t) => {
    const fkColumns = new Set(t.foreign_keys.map((fk) => fk.column));
    const data: TableNodeData = {
      tableName: t.name,
      columns: t.columns,
      fkColumns,
      columnCount: t.columns.length,
    };
    return {
      id: t.name,
      type: "table",
      position: { x: 0, y: 0 },
      data: data as unknown as Record<string, unknown>,
    };
  });

  const edges: Edge[] = [];
  for (const t of erd.tables) {
    for (const fk of t.foreign_keys) {
      const handleFrom = `${t.name}.${fk.column}`;
      const handleTo = `${fk.referenced_table}.${fk.referenced_column}`;
      edges.push({
        id: `${t.name}.${fk.column}->${fk.referenced_table}.${fk.referenced_column}`,
        source: t.name,
        sourceHandle: handleFrom,
        target: fk.referenced_table,
        targetHandle: handleTo,
        label: fk.relationship === "one-to-one" ? "1:1" : "1:N",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#2dd4f0" },
        style: { stroke: "#2dd4f0", strokeWidth: 1.5 },
        labelStyle: { fill: "#8592ac", fontSize: 10 },
        labelBgStyle: { fill: "#0d1220" },
        data: {
          constraintName: fk.constraint_name,
          fromTable: t.name,
          fromColumn: fk.column,
          toTable: fk.referenced_table,
          toColumn: fk.referenced_column,
        },
      });
    }
  }
  return { nodes, edges };
}

function ErdCanvas() {
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [activeConnId, setActiveConnId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tree, setTree] = useState<SchemaTree | null>(null);
  const [schema, setSchema] = useState("");
  const [loading, setLoading] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [erdData, setErdData] = useState<ErdData | null>(null);
  const [suggestedEdges, setSuggestedEdges] = useState<Edge[]>([]);

  const [pendingRelationship, setPendingRelationship] = useState<{
    mode: "create" | "delete";
    preview: string;
    description: string;
    createPayload?: CreateRelationshipPayload;
    deletePayload?: DeleteRelationshipPayload;
  } | null>(null);

  useEffect(() => {
    api.listConnections().then((cs) => {
      setConnections(cs);
      if (cs.length > 0) setActiveConnId(cs[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeConnId) return;
    api.getSchemas(activeConnId).then((t) => {
      setTree(t);
      if (t.schemas.length > 0) setSchema(t.schemas[0].schema);
    }).catch(() => {});
  }, [activeConnId]);

  const loadErd = useCallback(
    (forceAutoLayout = false) => {
      if (!activeConnId || !schema) return;
      setLoading(true);
      api
        .getErd(activeConnId, schema)
        .then((erd) => {
          setErdData(erd);
          setSuggestedEdges([]);
          const { nodes: n, edges: e } = buildGraph(erd);
          const laid = resolveErdLayout(n, e, activeConnId, schema, forceAutoLayout);
          setNodes(laid);
          setEdges(e);
        })
        .finally(() => setLoading(false));
    },
    [activeConnId, schema, setNodes, setEdges]
  );

  const handleSuggest = useCallback(() => {
    if (!erdData) return;
    const suggestions: SuggestedRelation[] = suggestRelationships(erdData);
    const sEdges: Edge[] = suggestions.map((s) => ({
      id: `sugg-${s.fromTable}.${s.fromColumn}->${s.toTable}.${s.toColumn}`,
      source: s.fromTable,
      sourceHandle: `${s.fromTable}.${s.fromColumn}`,
      target: s.toTable,
      targetHandle: `${s.toTable}.${s.toColumn}`,
      label: "?",
      animated: true,
      style: { stroke: "#fbbf24", strokeWidth: 1.5, strokeDasharray: "4 3" },
      labelStyle: { fill: "#fbbf24", fontSize: 10 },
      labelBgStyle: { fill: "#0d1220" },
      data: { suggested: true, ...s },
    }));
    setSuggestedEdges(sEdges);
  }, [erdData]);

  useEffect(() => {
    loadErd(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnId, schema]);

  const onNodeDragStop = useCallback(() => {
    if (!activeConnId || !schema) return;
    setNodes((nds) => {
      saveLayout(activeConnId, schema, nds);
      return nds;
    });
  }, [activeConnId, schema, setNodes]);

  const activeConnection = connections.find((c) => c.id === activeConnId);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.sourceHandle || !params.targetHandle || !activeConnId) return;
      const [fromTable, fromColumn] = params.sourceHandle.split(".");
      const [toTable, toColumn] = params.targetHandle.split(".");
      if (fromTable === toTable) return;

      const constraintName = `fk_${fromTable}_${fromColumn}`;
      const preview = previewAddFk(
        activeConnection?.db_type,
        schema,
        fromTable,
        fromColumn,
        toTable,
        toColumn,
        constraintName
      );
      setPendingRelationship({
        mode: "create",
        preview,
        description: `Menghubungkan ${fromTable}.${fromColumn} → ${toTable}.${toColumn} sebagai foreign key.`,
        createPayload: { schema, table: fromTable, column: fromColumn, refTable: toTable, refColumn: toColumn },
      });
    },
    [activeConnId, schema, activeConnection?.db_type]
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (edge.data?.suggested) {
        const d = edge.data as unknown as SuggestedRelation;
        const constraintName = `fk_${d.fromTable}_${d.fromColumn}`;
        const preview = previewAddFk(
          activeConnection?.db_type,
          schema,
          d.fromTable,
          d.fromColumn,
          d.toTable,
          d.toColumn,
          constraintName
        );
        setPendingRelationship({
          mode: "create",
          preview,
          description: `Menghubungkan ${d.fromTable}.${d.fromColumn} → ${d.toTable}.${d.toColumn} sebagai foreign key (${d.reason}).`,
          createPayload: {
            schema,
            table: d.fromTable,
            column: d.fromColumn,
            refTable: d.toTable,
            refColumn: d.toColumn,
          },
        });
        return;
      }
      const d = edge.data as {
        constraintName: string;
        fromTable: string;
        fromColumn: string;
        toTable: string;
        toColumn: string;
      };
      const preview = previewDropFk(activeConnection?.db_type, schema, d.fromTable, d.constraintName);
      setPendingRelationship({
        mode: "delete",
        preview,
        description: `Menghapus relasi ${d.fromTable}.${d.fromColumn} → ${d.toTable}.${d.toColumn} (constraint "${d.constraintName}").`,
        deletePayload: { schema, table: d.fromTable, constraintName: d.constraintName },
      });
    },
    [schema, activeConnection?.db_type]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="shrink-0 border-b border-border-glass dbx-glass px-5 py-2.5 flex items-center gap-3">
        <span className="text-xs text-text-muted">Connection:</span>
        {connections.length === 0 ? (
          <span className="text-xs text-text-faint">Belum ada koneksi database.</span>
        ) : (
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-2 text-sm text-text bg-panel-2 border border-border-glass rounded-lg px-3 py-1.5 hover:border-border-glass-strong transition-colors"
            >
              <Plug size={13} className="text-cyan" />
              {activeConnection?.name ?? "Pilih koneksi"}
              <ChevronDown size={13} className="text-text-faint" />
            </button>
            {pickerOpen && (
              <div className="absolute top-full mt-1 left-0 dbx-glass-strong rounded-lg py-1 min-w-[220px] z-20">
                {connections.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setActiveConnId(c.id);
                      setPickerOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-panel/60 transition-colors ${
                      c.id === activeConnId ? "text-cyan" : "text-text"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tree && tree.schemas.length > 1 && (
          <select
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            className="bg-void-2 border border-border-glass rounded-lg px-2.5 py-1.5 text-xs text-text"
          >
            {tree.schemas.map((s) => (
              <option key={s.schema} value={s.schema}>
                {s.schema}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => loadErd(false)}
            title="Refresh schema"
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text border border-border-glass rounded-lg px-2.5 py-1.5 transition-colors"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
          <button
            onClick={() => {
              const laid = layoutErdGraph(nodes, edges, "LR");
              setNodes(laid);
              if (activeConnId && schema) saveLayout(activeConnId, schema, laid);
            }}
            className="flex items-center gap-1.5 text-xs text-cyan border border-cyan/30 rounded-lg px-2.5 py-1.5 hover:bg-cyan/10 transition-colors"
          >
            <LayoutGrid size={13} />
            Auto Layout
          </button>
          <button
            onClick={handleSuggest}
            disabled={!erdData}
            title="Cari kolom bernama sama antar tabel yang mungkin punya relasi, seperti di MS Access"
            className="flex items-center gap-1.5 text-xs text-warning border border-warning/30 rounded-lg px-2.5 py-1.5 hover:bg-warning/10 transition-colors disabled:opacity-40"
          >
            <Sparkles size={13} />
            Sarankan Relasi
          </button>
          {suggestedEdges.length > 0 && (
            <button
              onClick={() => setSuggestedEdges([])}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text border border-border-glass rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <X size={13} />
              Bersihkan saran ({suggestedEdges.length})
            </button>
          )}
        </div>
      </div>

      {suggestedEdges.length > 0 && (
        <div className="shrink-0 border-b border-border-glass bg-warning/5 px-5 py-2 text-[11px] text-warning">
          {suggestedEdges.length} relasi disarankan berdasarkan nama kolom yang cocok antar tabel (garis putus-putus
          kuning) — klik garisnya untuk membuat FK, atau abaikan saja kalau tidak relevan.
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        <ReactFlow
          nodes={nodes}
          edges={[...edges, ...suggestedEdges]}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#8592ac" gap={24} size={1} style={{ opacity: 0.15 }} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            style={{ background: "#0d1220" }}
            maskColor="rgba(5,7,13,0.75)"
            nodeColor="#111830"
          />
        </ReactFlow>
      </div>

      {!loading && nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-text-faint">Tidak ada tabel ditemukan di schema ini.</p>
        </div>
      )}

      {pendingRelationship && activeConnId && (
        <RelationshipModal
          connectionId={activeConnId}
          mode={pendingRelationship.mode}
          preview={pendingRelationship.preview}
          description={pendingRelationship.description}
          createPayload={pendingRelationship.createPayload}
          deletePayload={pendingRelationship.deletePayload}
          onClose={() => setPendingRelationship(null)}
          onDone={() => loadErd(false)}
        />
      )}
    </div>
  );
}

export default function ErdPage() {
  return (
    <AppShell>
      <ReactFlowProvider>
        <ErdCanvas />
      </ReactFlowProvider>
    </AppShell>
  );
}
