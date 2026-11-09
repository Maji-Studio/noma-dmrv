import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { projectBatchRecords, type RemovalBatchRecords } from "@/lib/certification/removal-records";
import { getCreditBatchChainData } from "./chain-of-custody-batch";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { requireOrgScope } from "./utils";

/** The records of each credit batch in a Removal, in batch code order: this Removal's slice of each batch. */
export async function loadRemovalRecords(ctx: OrgContext, removalId: string): Promise<RemovalBatchRecords[]> {
  requireOrgScope(ctx);
  const batches = await getCreditBatchesByRemovalId(ctx, removalId);
  const facilityId = batches[0]?.facilityId;
  const [facility] = facilityId
    ? await db
        .select({ timezone: facilities.timezone })
        .from(facilities)
        .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)))
        .limit(1)
    : [];
  const chains = await Promise.all(batches.map((batch) => getCreditBatchChainData(ctx, batch.id, { removalId })));
  return chains.map((chain) => projectBatchRecords(chain, facility?.timezone)).sort((a, b) => a.code.localeCompare(b.code));
}
