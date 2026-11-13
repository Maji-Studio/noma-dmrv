import type { OrgContext } from "@/lib/auth/server";
import { RECORD_USED_BY_KINDS, usedByNodeKey, type RecordUsedByChain, type RecordUsedByEdge, type RecordUsedByKind, type RecordUsedByMass, type RecordUsedByNode } from "@/lib/record-used-by-chain";
import { normalizeUsedByEdges, orderUsedByNodes } from "@/lib/record-used-by-chain-graph";
import { readUsedByBatches } from "./record-used-by-chain-batches";
import { readUsedByDownstreamEdges, readUsedByUpstreamEdges } from "./record-used-by-chain-links";
import { readUsedByNodes } from "./record-used-by-chain-nodes";
import { readUsedByRunDeliveryShares } from "./record-used-by-chain-stock";
import { requireOrgScope } from "./utils";

/** Feedstock to Removal is five material hops; one extra covers cohort Samples. */
const MAX_DEPTH = 6;

/** Hydrate all unresolved endpoints once per kind at each depth. */
async function readEdgeNodes(ctx: OrgContext, edges: RecordUsedByEdge[], known: Map<string, RecordUsedByNode>): Promise<RecordUsedByNode[]> {
  requireOrgScope(ctx);
  const keys = new Set(edges.flatMap(edge => [edge.from, edge.to]).filter(key => !known.has(key)));
  return (await Promise.all(RECORD_USED_BY_KINDS.map(kind => {
    const prefix = `${kind}:`;
    return readUsedByNodes(ctx, kind, [...keys].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)));
  }))).flat();
}

/** Read-only advisory lineage. Unknown, foreign and deleted products answer null. */
export async function getRecordUsedByChain(ctx: OrgContext, kind: RecordUsedByKind, id: string): Promise<RecordUsedByChain | null> {
  requireOrgScope(ctx);
  const [self] = await readUsedByNodes(ctx, kind, [id]);
  if (!self) return null;
  const selfKey = usedByNodeKey(self.kind, self.id);
  const known = new Map([[selfKey, self]]);
  const downstream: RecordUsedByNode[] = [];
  const edges: RecordUsedByEdge[] = [];
  let frontier = [self];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth += 1) {
    const byKind = new Map<RecordUsedByKind, string[]>();
    for (const node of frontier) {
      const ids = byKind.get(node.kind) ?? [];
      ids.push(node.id);
      byKind.set(node.kind, ids);
    }
    const expanded = (await Promise.all([...byKind].map(([nodeKind, ids]) => readUsedByDownstreamEdges(ctx, nodeKind, ids)))).flat();
    const next = await readEdgeNodes(ctx, expanded, known);
    edges.push(...expanded);
    for (const node of next) known.set(usedByNodeKey(node.kind, node.id), node);
    downstream.push(...next);
    // Discovered orders supply delivery context only. An order requested as
    // self expands normally on the first iteration. Every other node expands once.
    frontier = next.filter(node => node.kind !== "order");
  }
  const upstreamEdges = await readUsedByUpstreamEdges(ctx, kind, self.id);
  const upstreamNodes = await readEdgeNodes(ctx, upstreamEdges, new Map([[selfKey, self]]));
  const upstream = orderUsedByNodes(upstreamNodes);
  const allNodes = [self, ...upstream, ...downstream];
  const normalizedEdges = normalizeUsedByEdges([...upstreamEdges, ...edges], allNodes);
  const took: Record<string, RecordUsedByMass> = {};
  for (const edge of normalizedEdges) if (edge.from === selfKey && edge.mass) took[edge.to] = edge.mass;
  // Keep the prototype's useful run-share readout even through a product layer.
  if (kind === "productionRun") {
    const shares = await readUsedByRunDeliveryShares(ctx, self.id);
    for (const [key, mass] of Object.entries(shares)) if (known.has(key)) took[key] = mass;
  }
  return { self, upstream, downstream: orderUsedByNodes(downstream), edges: normalizedEdges,
    creditBatches: await readUsedByBatches(ctx, self, upstream, downstream), took };
}
