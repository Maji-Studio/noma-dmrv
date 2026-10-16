import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { emissionEntryFlows } from "@/lib/energy/emission-entry-flows";
import type { EnergyFlow } from "@/lib/energy/types";
import { requireOrgScope, requireOrgFacility } from "./utils";
import { getLatestTemplateObservation } from "./removal-template-observations";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";

export async function loadFacilityEmissionEntryFlows(ctx: OrgContext, facilityId: string): Promise<EnergyFlow[]> {
  requireOrgScope(ctx);
  if (!emissionsEntriesEnabled()) return [];
  await requireOrgFacility(ctx, facilityId);
  const batches = await db.select({ id: creditBatches.id, removalTemplateId: creditBatches.removalTemplateId })
    .from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId),
      eq(creditBatches.facilityId, facilityId), isNull(creditBatches.archivedAt)));
  const flows: EnergyFlow[] = [];
  for (const batch of batches) {
    if (!batch.removalTemplateId) continue;
    const observation = await getLatestTemplateObservation(ctx, "isometric", batch.removalTemplateId);
    if (!observation) continue;
    const { entries } = await loadBatchEmissionEntryFacts(ctx, batch.id, observation);
    flows.push(...emissionEntryFlows(entries, observation.lineSources));
  }
  return flows;
}
