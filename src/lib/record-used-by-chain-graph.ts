import {
  RECORD_USED_BY_KINDS, usedByNodeKey,
  type RecordUsedByEdge, type RecordUsedByKind, type RecordUsedByNode,
} from "./record-used-by-chain";

/** Custody order, then date (unknown last), code and id to break every tie. */
export function orderUsedByNodes(nodes: readonly RecordUsedByNode[]): RecordUsedByNode[] {
  const unique = new Map(nodes.map(node => [usedByNodeKey(node.kind, node.id), node]));
  return [...unique.values()].sort((a, b) =>
    RECORD_USED_BY_KINDS.indexOf(a.kind) - RECORD_USED_BY_KINDS.indexOf(b.kind)
    || (a.at === b.at ? 0 : a.at === null ? 1 : b.at === null ? -1 : Date.parse(a.at) - Date.parse(b.at))
    || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
}

/** Keep each link once, ordered by its endpoints, without dangling or self edges. */
export function normalizeUsedByEdges(edges: readonly RecordUsedByEdge[], nodes: readonly RecordUsedByNode[]): RecordUsedByEdge[] {
  const ordered = orderUsedByNodes(nodes);
  const rank = new Map(ordered.map((node, index) => [usedByNodeKey(node.kind, node.id), index]));
  const unique = new Map<string, RecordUsedByEdge>();
  for (const edge of edges) {
    if (edge.from === edge.to || !rank.has(edge.from) || !rank.has(edge.to)) continue;
    const key = `${edge.from}>${edge.to}`;
    if (!unique.has(key)) unique.set(key, edge);
  }
  return [...unique.values()].sort((a, b) => rank.get(a.from)! - rank.get(b.from)! || rank.get(a.to)! - rank.get(b.to)!);
}

export function usedByEdge(fromKind: RecordUsedByKind, fromId: string, toKind: RecordUsedByKind, toId: string): RecordUsedByEdge {
  return { from: usedByNodeKey(fromKind, fromId), to: usedByNodeKey(toKind, toId) };
}
