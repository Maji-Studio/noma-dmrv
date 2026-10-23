import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { creditBatchApplications, creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { entryInputManifestSchema, type RemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import { isCarriedToRemoval } from "@/lib/certification/emission-entry-carry";
import { entryLine } from "@/lib/certification/emission-entry-rules";
import { requireOrgScope } from "./utils";
import { getCertifierRemovalById } from "./certifier-removals";
import { getSentRemovalForComparison } from "./removal-entry-correction";
import { loadFacilityEmissionEntryCarry } from "./emission-entry-carry";
import { getTemplateObservationById } from "./removal-template-observations";
import { getRemovalCodes } from "./removal-codes";

export type RemovalCarriedEntry = NonNullable<RemovalEntryContributions["carriedEntries"]>[number];
const snapshotSchema = z.object({
  templateObservationId: z.string().optional(),
  semantic: z.object({
    entryContributions: z.array(entryInputManifestSchema).default([]),
    carriedEntries: z.array(z.object({ entryId: z.string(), earlierRemovalId: z.string().optional() })).default([]),
  }),
});

/** Persisted sheet read: no certify context, registry refresh, storage or writes. */
export async function loadRemovalCarriedEntries(ctx: OrgContext, removalId: string): Promise<RemovalCarriedEntry[]> {
  requireOrgScope(ctx);
  const removal = await getCertifierRemovalById(ctx, removalId);
  if (!removal) throw new SafeError("Removal was not found.");
  const members = await db.selectDistinct({ id: creditBatchApplications.creditBatchId }).from(creditBatchApplications).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.removalId, removalId),
  ));
  const memberIds = new Set(members.map(member => member.id));
  const sent = await getSentRemovalForComparison(ctx, removalId);
  if (!sent) {
    const carry = await loadFacilityEmissionEntryCarry(ctx, removal.facilityId, undefined, undefined, { ownedRemovalId: removalId }, true);
    return carry.entries.filter(entry => !memberIds.has(entry.creditBatchId) && isCarriedToRemoval(entry, removalId))
      .map(entry => ({ entryId: entry.id, creditBatchId: entry.creditBatchId, creditBatchCode: entry.creditBatchCode,
        componentId: entry.componentId, componentName: entryLine(entry.entryObservation, entry.componentId)?.component.displayName,
        occurredOn: entry.occurredOn, value: entry.values[0], evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
        earlierRemovalId: entry.earlierRemovalId, earlierRemovalCode: entry.earlierRemovalCode,
      })).sort((a, b) => a.entryId.localeCompare(b.entryId));
  }
  const parsed = snapshotSchema.safeParse(sent.payloadSnapshot);
  if (!parsed.success) throw new SafeError("The saved emissions entry set could not be read. Refresh the Removal before submitting.");
  const snapshot = parsed.data;
  const entries = [...new Map(snapshot.semantic.entryContributions.flatMap(input => input.entries
    .filter(entry => !memberIds.has(entry.creditBatchId)).map(entry => [entry.entryId, { ...entry, componentId: input.componentId, componentName: input.componentDisplayName }] as const))).values()];
  if (!entries.length) return [];
  const earlier = new Map(snapshot.semantic.carriedEntries.map(entry => [entry.entryId, entry.earlierRemovalId]));
  const [batches, observation, codes] = await Promise.all([
    db.select({ id: creditBatches.id, code: creditBatches.code }).from(creditBatches).where(and(
      eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, removal.facilityId),
      inArray(creditBatches.id, [...new Set(entries.map(entry => entry.creditBatchId))]),
    )),
    snapshot.templateObservationId ? getTemplateObservationById(ctx, snapshot.templateObservationId) : null,
    getRemovalCodes(ctx, [...earlier.values()].filter((id): id is string => !!id)),
  ]);
  return entries.map(entry => {
    const batch = batches.find(batch => batch.id === entry.creditBatchId);
    if (!batch || !entry.occurredOn) throw new SafeError("The saved emissions entry set could not be read. Refresh the Removal before submitting.");
    const earlierRemovalId = earlier.get(entry.entryId);
    return { entryId: entry.entryId, creditBatchId: entry.creditBatchId, creditBatchCode: batch.code,
      componentId: entry.componentId, componentName: entry.componentName ?? (observation ? entryLine(observation, entry.componentId)?.component.displayName : undefined),
      occurredOn: entry.occurredOn, value: entry.value, evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
      earlierRemovalId, earlierRemovalCode: earlierRemovalId ? codes.get(earlierRemovalId) : undefined,
    };
  }).sort((a, b) => a.entryId.localeCompare(b.entryId));
}
