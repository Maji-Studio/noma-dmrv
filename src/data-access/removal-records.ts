import type { OrgContext } from "@/lib/auth/server";
import { projectBatchRecords, type RemovalBatchRecords } from "@/lib/certification/removal-records";
import { getCreditBatchChainData } from "./chain-of-custody-batch";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { requireOrgScope } from "./utils";

/** The records of each credit batch in a Removal, in batch code order: this Removal's slice of each batch. */
export async function loadRemovalRecords(ctx: OrgContext, removalId: string): Promise<RemovalBatchRecords[]> {
  requireOrgScope(ctx);
  const batches = await getCreditBatchesByRemovalId(ctx, removalId);
  const chains = await Promise.all(batches.map((batch) => getCreditBatchChainData(ctx, batch.id, { removalId })));
  return chains.map(projectBatchRecords).sort((a, b) => a.code.localeCompare(b.code));
}
