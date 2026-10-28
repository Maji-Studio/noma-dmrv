/**
 * Flow chart layout: fixed columns by record kind in chain order, small square
 * nodes, and a column that holds more than FLOW_GROUP_THRESHOLD records
 * collapsed into one stacked group node until it is expanded. Pure, so the
 * layout is unit tested without a canvas.
 */
import type { Edge, Node } from "@xyflow/react";
import { flowEdgeId } from "@/lib/chain-of-custody/lineage-mass-totals";
import {
  FLOW_COLUMN_PITCH,
  FLOW_COLUMNS,
  FLOW_EQUIPMENT_KINDS,
  FLOW_GROUP_THRESHOLD,
  FLOW_HEADER_GAP,
  FLOW_HEADER_HEIGHT,
  FLOW_HEADER_WIDTH,
  FLOW_NODE_BOX_HEIGHT,
  FLOW_NODE_BOX_WIDTH,
  FLOW_NODE_SIZE,
  FLOW_ROW_PITCH,
  LINEAGE_NODE_STYLES,
  type LineageNodeKind,
} from "./chain-constants";
import { computeEdgeShareLabels, mergeEdgeMass, type ChainEdgeBuildData } from "./chain-edge-mass";
import type { ChainNodeData, FlowColumnNodeData, FlowGroupNodeData } from "./chain-node";

export const flowGroupId = (kind: LineageNodeKind) => `group:${kind}`;
export const flowColumnId = (kind: LineageNodeKind) => `column:${kind}`;

export interface FlowLayoutOptions {
  /** Columns the operator expanded past the group threshold. */
  expandedKinds: ReadonlySet<LineageNodeKind>;
  /** Header "Collapse" action for an expanded column. */
  onCollapse?: (kind: LineageNodeKind) => void;
}

export interface FlowLayout {
  /** Column headers, record nodes and group nodes, positioned. */
  nodes: Node[];
  /** Edges between displayed nodes; parallel edges into a group merged. */
  edges: Edge[];
  /** Record id → the id it is drawn as (itself, or its collapsed group). */
  displayIdOf: (nodeId: string) => string;
}

const numericCompare = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true });

function nodeData(node: Node): ChainNodeData {
  return node.data as unknown as ChainNodeData;
}

/**
 * One column's y positions: each node wants the mean height of its already
 * placed neighbours. Nodes keep that order, are pushed apart to one row
 * pitch, then the column shifts so the average displacement is zero.
 */
function packColumn(
  ids: string[],
  sortKey: Map<string, string>,
  desired: Map<string, number | undefined>,
): Map<string, number> {
  const known = ids.filter((id) => desired.get(id) !== undefined);
  const unknown = ids.filter((id) => desired.get(id) === undefined);
  known.sort((left, right) => {
    const delta = (desired.get(left) ?? 0) - (desired.get(right) ?? 0);
    return delta !== 0 ? delta : numericCompare(sortKey.get(left) ?? left, sortKey.get(right) ?? right);
  });
  unknown.sort((left, right) => numericCompare(sortKey.get(left) ?? left, sortKey.get(right) ?? right));
  const ordered = [...known, ...unknown];
  const placed = new Map<string, number>();
  let previous: number | null = null;
  for (const id of ordered) {
    const next: number | null = previous === null ? null : previous + FLOW_ROW_PITCH;
    const want = desired.get(id) ?? next ?? 0;
    const y: number = next === null ? want : Math.max(want, next);
    placed.set(id, y);
    previous = y;
  }
  const wanting = ordered.filter((id) => desired.get(id) !== undefined);
  const shift = wanting.length
    ? wanting.reduce((sum, id) => sum + (desired.get(id)! - placed.get(id)!), 0) / wanting.length
    : -((ordered.length - 1) * FLOW_ROW_PITCH) / 2;
  for (const id of ordered) placed.set(id, placed.get(id)! + shift);
  return placed;
}

function mean(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

export function layoutFlow(nodes: Node[], edges: Edge[], options: FlowLayoutOptions): FlowLayout {
  const byKind = new Map<LineageNodeKind, Node[]>();
  for (const node of nodes) {
    const kind = nodeData(node).kind;
    byKind.set(kind, [...(byKind.get(kind) ?? []), node]);
  }
  const columns = FLOW_COLUMNS.filter((kind) => (byKind.get(kind)?.length ?? 0) > 0);

  // Collapse crowded columns into one group node each.
  const groupOf = new Map<string, string>();
  const displayNodes: Node[] = [];
  const kindOf = new Map<string, LineageNodeKind>();
  const sortKey = new Map<string, string>();
  for (const kind of columns) {
    const members = byKind.get(kind)!;
    const collapsed = members.length > FLOW_GROUP_THRESHOLD && !options.expandedKinds.has(kind);
    if (!collapsed) {
      for (const member of members) {
        displayNodes.push(member);
        kindOf.set(member.id, kind);
        sortKey.set(member.id, nodeData(member).shortCode);
      }
      continue;
    }
    const id = flowGroupId(kind);
    const style = LINEAGE_NODE_STYLES[kind];
    for (const member of members) groupOf.set(member.id, id);
    kindOf.set(id, kind);
    sortKey.set(id, id);
    displayNodes.push({
      id,
      type: "flowGroup",
      position: { x: 0, y: 0 },
      ariaLabel: `Show all ${members.length} ${style.plural}`,
      data: {
        kind,
        title: `${members.length} ${style.plural}`,
        memberIds: members.map((member) => member.id),
        icon: style.icon,
        accent: style.accent,
      } satisfies FlowGroupNodeData,
    });
  }
  const displayIdOf = (nodeId: string) => groupOf.get(nodeId) ?? nodeId;

  // Merge parallel edges that now share both ends.
  const merged = new Map<string, Edge[]>();
  for (const graphEdge of edges) {
    const source = displayIdOf(graphEdge.source);
    const target = displayIdOf(graphEdge.target);
    if (source === target) continue;
    const id = flowEdgeId(source, target);
    merged.set(id, [...(merged.get(id) ?? []), { ...graphEdge, source, target }]);
  }
  const displayEdges: Edge[] = Array.from(merged, ([id, group]) => {
    const [first] = group;
    const data =
      group.length === 1
        ? { ...(first.data as ChainEdgeBuildData) }
        : mergeEdgeMass(group.map((member) => member.data as ChainEdgeBuildData));
    return { ...first, id, data };
  });
  if (groupOf.size > 0) computeEdgeShareLabels(displayEdges);

  // Rows: left to right, each node at the mean height of its placed neighbours.
  const neighbours = new Map<string, string[]>();
  for (const graphEdge of displayEdges) {
    neighbours.set(graphEdge.source, [...(neighbours.get(graphEdge.source) ?? []), graphEdge.target]);
    neighbours.set(graphEdge.target, [...(neighbours.get(graphEdge.target) ?? []), graphEdge.source]);
  }
  const idsOf = (kind: LineageNodeKind) =>
    displayNodes.filter((node) => kindOf.get(node.id) === kind).map((node) => node.id);
  const y = new Map<string, number>();
  const placeColumn = (kind: LineageNodeKind) => {
    const ids = idsOf(kind);
    const desired = new Map<string, number | undefined>();
    for (const id of ids) {
      const placedNeighbours = (neighbours.get(id) ?? [])
        .map((other) => y.get(other))
        .filter((value): value is number => value !== undefined);
      desired.set(
        id,
        FLOW_EQUIPMENT_KINDS.has(kind) && placedNeighbours.length
          ? Math.min(...placedNeighbours) - FLOW_ROW_PITCH
          : mean(placedNeighbours),
      );
    }
    for (const [id, value] of packColumn(ids, sortKey, desired)) y.set(id, value);
    return ids.some((id) => desired.get(id) === undefined);
  };
  const flowColumns = columns.filter((kind) => !FLOW_EQUIPMENT_KINDS.has(kind));
  // A column whose nodes had no placed neighbour yet (an order, ahead of its
  // delivery) is placed again once the columns after it exist.
  const revisit: LineageNodeKind[] = [];
  flowColumns.forEach((kind, index) => {
    const hadUnplacedNeighbours = placeColumn(kind);
    if (hadUnplacedNeighbours && index > 0) revisit.push(kind);
  });
  for (const kind of revisit) {
    for (const id of idsOf(kind)) y.delete(id);
    placeColumn(kind);
  }
  for (const kind of columns.filter((candidate) => FLOW_EQUIPMENT_KINDS.has(candidate))) placeColumn(kind);

  const top = Math.min(...Array.from(y.values()));
  const columnX = (kind: LineageNodeKind) => columns.indexOf(kind) * FLOW_COLUMN_PITCH;
  const positioned: Node[] = displayNodes.map((node) => ({
    ...node,
    position: {
      x: columnX(kindOf.get(node.id)!) - FLOW_NODE_BOX_WIDTH / 2,
      y: y.get(node.id)! - FLOW_NODE_SIZE / 2,
    },
    width: FLOW_NODE_BOX_WIDTH,
    height: FLOW_NODE_BOX_HEIGHT,
  }));

  const headers: Node[] = columns.map((kind) => {
    const count = byKind.get(kind)!.length;
    const expandedPastThreshold = count > FLOW_GROUP_THRESHOLD && options.expandedKinds.has(kind);
    return {
      id: flowColumnId(kind),
      type: "flowColumn",
      position: { x: columnX(kind) - FLOW_HEADER_WIDTH / 2, y: top - FLOW_HEADER_GAP },
      width: FLOW_HEADER_WIDTH,
      height: FLOW_HEADER_HEIGHT,
      selectable: false,
      focusable: false,
      data: {
        kind,
        title: LINEAGE_NODE_STYLES[kind].label,
        count,
        onCollapse:
          expandedPastThreshold && options.onCollapse
            ? () => options.onCollapse?.(kind)
            : undefined,
      } satisfies FlowColumnNodeData,
    };
  });

  return { nodes: [...headers, ...positioned], edges: displayEdges, displayIdOf };
}
