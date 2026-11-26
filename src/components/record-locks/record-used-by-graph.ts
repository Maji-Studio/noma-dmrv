import { traceabilityApplicationHref, traceabilityBatchHref } from "@/lib/certification/links";
import type { RecordLockLink } from "@/lib/record-lock-view";
import { usedByNodeKey, type RecordUsedByBatch, type RecordUsedByChain, type RecordUsedByEdge } from "@/lib/record-used-by-chain";
import { recordLockLinkTitle } from "./record-lock-labels";
import { kindRank, nodeDay, type UsedByNode } from "./record-used-by-kinds";

/** Records shown per kind before the rest fold behind "and N more". */
export const SHOWN_PER_KIND = 3;

/** The chain with the users the lock read names but the chain read does not reach. */
export interface UsedByGraph {
  self: UsedByNode;
  downstream: UsedByNode[];
  edges: RecordUsedByEdge[];
  creditBatches: RecordUsedByBatch[];
}

const keyOf = (node: UsedByNode) => usedByNodeKey(node.kind, node.id);

/**
 * Users the chain read does not reach (a stock count) still show, linked
 * straight from this record, so nothing in "Used by" goes missing.
 */
export function withUnmatchedUsers(chain: RecordUsedByChain, usedBy: RecordLockLink[]): UsedByGraph {
  const known = new Set(chain.downstream.map(keyOf));
  const selfKey = keyOf(chain.self);
  const extra: UsedByNode[] = usedBy
    .filter((link) => link.kind !== "creditBatch" && !known.has(usedByNodeKey(link.kind, link.id)))
    .map((link) => ({
      kind: link.kind, id: link.id, code: link.label ?? recordLockLinkTitle(link), name: null,
      facilityId: link.facilityId, at: link.period?.completedOn ?? null, calendarDay: true,
    }));
  const edges = extra.map((node) => ({ from: selfKey, to: keyOf(node) }));
  return {
    self: chain.self,
    downstream: [...chain.downstream, ...extra],
    edges: [...chain.edges, ...edges],
    creditBatches: chain.creditBatches,
  };
}

/** Nothing to list: no direct user, no batch and no later Removal. */
export function usedByGraphIsEmpty(graph: UsedByGraph): boolean {
  return directUserGroups(graph).length === 0 && namedBatches(graph).length === 0 && laterRemovals(graph).length === 0;
}

/** Oldest first; records without a day last, then by code. */
export function byDay(nodes: UsedByNode[]): UsedByNode[] {
  const time = (node: UsedByNode) => (node.at ? Date.parse(node.at) : Number.POSITIVE_INFINITY);
  return [...nodes].sort((a, b) => time(a) - time(b) || a.code.localeCompare(b.code));
}

/**
 * The records that used this one directly, one group per kind in step order,
 * each oldest first. A credit batch is context, never a step, and samples
 * reached through it belong to the batch, so only direct links count.
 */
export function directUserGroups(graph: UsedByGraph): [string, UsedByNode[]][] {
  const selfKey = keyOf(graph.self);
  const direct = new Set(graph.edges.filter((edge) => edge.from === selfKey).map((edge) => edge.to));
  const byKind = new Map<string, UsedByNode[]>();
  for (const node of graph.downstream) {
    if (node.kind === "creditBatch" || !direct.has(keyOf(node))) continue;
    byKind.set(node.kind, [...(byKind.get(node.kind) ?? []), node]);
  }
  return [...byKind]
    .sort(([a], [b]) => kindRank(a) - kindRank(b))
    .map(([kind, nodes]) => [kind, byDay(nodes)]);
}

/** Removals the chain reaches through later records (direct ones are already a group). */
export function laterRemovals(graph: UsedByGraph): UsedByNode[] {
  const selfKey = keyOf(graph.self);
  const direct = new Set(graph.edges.filter((edge) => edge.from === selfKey).map((edge) => edge.to));
  return graph.downstream.filter((node) => node.kind === "removal" && !direct.has(keyOf(node)));
}

/** The credit batches to name; none on a credit batch's own sheet, whose title already names it. */
export function namedBatches(graph: UsedByGraph): RecordUsedByBatch[] {
  return graph.self.kind === "creditBatch" ? [] : graph.creditBatches;
}

/** "Apr 2 to Jun 28" over the records' days; null when none has a day. */
export function dayRange(nodes: UsedByNode[], timeZone: string): string | null {
  const dated = byDay(nodes).filter((node) => node.at);
  if (dated.length === 0) return null;
  const start = nodeDay(dated[0], timeZone);
  const end = nodeDay(dated[dated.length - 1], timeZone);
  return start === end ? start : `${start} to ${end}`;
}

/** Where "Open in Traceability" goes for this record; null when no material credit batch holds it (an emissions-only batch has no lineage to draw). */
export function traceabilityHref(graph: UsedByGraph): string | null {
  const { self, creditBatches } = graph;
  if (self.kind === "creditBatch" && self.facilityId) return traceabilityBatchHref(self.id, self.facilityId);
  const batch = creditBatches.find((candidate) => candidate.dependency !== "production-emissions");
  if (!batch) return null;
  if (self.kind === "application") return traceabilityApplicationHref(batch.id, self.id);
  const href = traceabilityBatchHref(batch.id, batch.facilityId);
  return self.kind === "productionRun" ? `${href}&${new URLSearchParams({ run: self.id })}` : href;
}
