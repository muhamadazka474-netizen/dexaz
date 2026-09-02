import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH = 260;

function estimateNodeHeight(columnCount: number): number {
  return 44 + columnCount * 26 + 12;
}

export function layoutErdGraph(nodes: Node[], edges: Edge[], direction: "TB" | "LR" = "LR"): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 110, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const columnCount = (node.data as { columnCount?: number })?.columnCount ?? 4;
    g.setNode(node.id, { width: NODE_WIDTH, height: estimateNodeHeight(columnCount) });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const columnCount = (node.data as { columnCount?: number })?.columnCount ?? 4;
    const height = estimateNodeHeight(columnCount);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - height / 2,
      },
    };
  });
}

/* ============================================================
   Layout persistence — remembers where the user dragged each
   table so a page refresh (or switching away and back) doesn't
   silently re-run auto-layout and undo their arrangement.
   Stored client-side (localStorage), keyed per connection+schema,
   matching the app's local-first / no-backend-round-trip approach.
   ============================================================ */

const STORAGE_PREFIX = "dbx:erd-layout";

export type LayoutPositions = Record<string, { x: number; y: number }>;

function storageKey(connectionId: string, schema: string): string {
  return `${STORAGE_PREFIX}:${connectionId}:${schema}`;
}

export function loadStoredLayout(connectionId: string, schema: string): LayoutPositions | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(connectionId, schema));
    if (!raw) return null;
    return JSON.parse(raw) as LayoutPositions;
  } catch {
    return null;
  }
}

export function saveLayout(connectionId: string, schema: string, nodes: Node[]): void {
  if (typeof window === "undefined") return;
  const positions: LayoutPositions = {};
  for (const n of nodes) {
    positions[n.id] = { x: n.position.x, y: n.position.y };
  }
  try {
    window.localStorage.setItem(storageKey(connectionId, schema), JSON.stringify(positions));
  } catch {
    // Quota exceeded or storage disabled — layout just won't persist, not fatal.
  }
}

export function clearStoredLayout(connectionId: string, schema: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(connectionId, schema));
  } catch {
    // ignore
  }
}

/**
 * Figure out where each node should be placed for this load:
 * - `forceAutoLayout` (the "Auto Layout" button): always re-run dagre and
 *   save the result as the new remembered layout.
 * - Otherwise: reuse whatever the user last arranged. Tables that already
 *   have a saved position keep it exactly. Brand-new tables (added to the
 *   database since the layout was last saved) get auto-placed off to the
 *   side via dagre, without disturbing anything the user already positioned.
 * - If nothing has ever been saved for this connection+schema, fall back
 *   to a full auto-layout once, and save it so it's stable from then on.
 */
export function resolveErdLayout(
  nodes: Node[],
  edges: Edge[],
  connectionId: string,
  schema: string,
  forceAutoLayout: boolean
): Node[] {
  if (forceAutoLayout) {
    const laid = layoutErdGraph(nodes, edges, "LR");
    saveLayout(connectionId, schema, laid);
    return laid;
  }

  const stored = loadStoredLayout(connectionId, schema);
  if (!stored) {
    const laid = layoutErdGraph(nodes, edges, "LR");
    saveLayout(connectionId, schema, laid);
    return laid;
  }

  const missing = nodes.filter((n) => !stored[n.id]);
  let positioned = nodes.map((n) => (stored[n.id] ? { ...n, position: stored[n.id] } : n));

  if (missing.length > 0) {
    const maxX = positioned.reduce(
      (max, n) => (stored[n.id] ? Math.max(max, n.position.x) : max),
      0
    );
    const laidMissing = layoutErdGraph(missing, edges, "LR");
    const offsetBase = maxX + 340;
    positioned = positioned.map((n) => {
      if (stored[n.id]) return n;
      const laidNode = laidMissing.find((m) => m.id === n.id);
      const pos = laidNode
        ? { x: laidNode.position.x + offsetBase, y: laidNode.position.y }
        : { x: offsetBase, y: 0 };
      return { ...n, position: pos };
    });
  }

  saveLayout(connectionId, schema, positioned);
  return positioned;
}
