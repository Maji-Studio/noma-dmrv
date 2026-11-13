import {
  RECORD_USED_BY_KINDS, usedByNodeKey,
  type RecordUsedByEdge, type RecordUsedByKind, type RecordUsedByMass, type RecordUsedByNode,
} from "./record-used-by-chain";

/** Missing, non-finite and nonpositive figures never become displayed masses. */
export function usedByMass(kg: number | null, basis: RecordUsedByMass["basis"]): RecordUsedByMass | null {
  return kg !== null && Number.isFinite(kg) && kg > 0 ? { kg, basis } : null;
}

/** Custody order, then date (unknown last), code and id to break every tie. */
export function orderUsedByNodes(nodes: readonly RecordUsedByNode[]): RecordUsedByNode[] {
  const unique = new Map(nodes.map(node => [usedByNodeKey(node.kind, node.id), node]));
  return [...unique.values()].sort((a, b) =>
    RECORD_USED_BY_KINDS.indexOf(a.kind) - RECORD_USED_BY_KINDS.indexOf(b.kind)
    || (a.at === b.at ? 0 : a.at === null ? 1 : b.at === null ? -1 : Date.parse(a.at) - Date.parse(b.at))
    || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
}

/** Queries aggregate allocations first. Seeing a link twice never doubles its mass. */
export function normalizeUsedByEdges(edges: readonly RecordUsedByEdge[], nodes: readonly RecordUsedByNode[]): RecordUsedByEdge[] {
  const ordered = orderUsedByNodes(nodes);
  const rank = new Map(ordered.map((node, index) => [usedByNodeKey(node.kind, node.id), index]));
  const unique = new Map<string, RecordUsedByEdge>();
  for (const edge of edges) {
    if (edge.from === edge.to || !rank.has(edge.from) || !rank.has(edge.to)) continue;
    const key = `${edge.from}>${edge.to}`;
    const mass = edge.mass ? usedByMass(edge.mass.kg, edge.mass.basis) : null;
    // Prefer the attributed mass over a contextual link with no mass.
    if (!unique.has(key) || mass) unique.set(key, { ...edge, mass });
  }
  return [...unique.values()].sort((a, b) => rank.get(a.from)! - rank.get(b.from)! || rank.get(a.to)! - rank.get(b.to)!);
}

export function usedByEdge(fromKind: RecordUsedByKind, fromId: string, toKind: RecordUsedByKind, toId: string, mass: RecordUsedByMass | null = null): RecordUsedByEdge {
  return { from: usedByNodeKey(fromKind, fromId), to: usedByNodeKey(toKind, toId), mass };
}
