import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { emissionEntryFlows } from "@/lib/energy/emission-entry-flows";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import type { EnergyFlow } from "@/lib/energy/types";
import { requireOrgScope, requireOrgFacility } from "./utils";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "./removal-template-observations";
import { listEmissionEntriesForBatches } from "./emission-entries";

export async function loadFacilityEmissionEntryFlows(ctx: OrgContext, facilityId: string): Promise<EnergyFlow[]> {
  requireOrgScope(ctx);
  if (!emissionsEntriesEnabled()) return [];
  await requireOrgFacility(ctx, facilityId);
  const batches = await db.select({ id: creditBatches.id, removalTemplateId: creditBatches.removalTemplateId })
    .from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId),
      eq(creditBatches.facilityId, facilityId), isNull(creditBatches.archivedAt)));
  const templateIds = [...new Set(batches.flatMap((batch) => batch.removalTemplateId ? [batch.removalTemplateId] : []))];
  if (!templateIds.length) return [];
  const observations = await getLatestTemplateObservations(ctx, "isometric", templateIds);
  const byTemplate = new Map(observations.map((observation) => [observation.externalTemplateId, observation]));
  const readableBatches = batches.filter((batch) => batch.removalTemplateId && byTemplate.has(batch.removalTemplateId));
  const storedEntries = await listEmissionEntriesForBatches(ctx, readableBatches.map((batch) => batch.id));
  const byId = new Map(observations.map((observation) => [observation.id, observation]));
  const previousIds = [...new Set(storedEntries.map((entry) => entry.observationId))].filter((id) => !byId.has(id));
  const previous = await getTemplateObservationsByIds(ctx, previousIds);
  for (const observation of previous) byId.set(observation.id, observation);
  const entriesByBatch = new Map<string, typeof storedEntries>();
  for (const entry of storedEntries) {
    const entries = entriesByBatch.get(entry.creditBatchId) ?? [];
    entries.push(entry);
    entriesByBatch.set(entry.creditBatchId, entries);
  }
  return readableBatches.flatMap((batch) => {
    const observation = byTemplate.get(batch.removalTemplateId!)!;
    const entries = deriveEmissionEntryFacts(entriesByBatch.get(batch.id) ?? [], observation, byId);
    return emissionEntryFlows(entries, observation.lineSources);
  });
}
