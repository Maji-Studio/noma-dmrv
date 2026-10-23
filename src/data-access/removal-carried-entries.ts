import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { type RemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import { entryLine } from "@/lib/certification/emission-entry-rules";
import { requireOrgScope } from "./utils";
import { getCertifierRemovalById } from "./certifier-removals";
import { getSentRemovalForComparison } from "./removal-entry-correction";
import { loadDraftRemovalCarriedEntries } from "./removal-draft-carried-entries";
import { getTemplateObservationById } from "./removal-template-observations";
import { getRemovalCodes } from "./removal-codes";

export type RemovalCarriedEntry = NonNullable<RemovalEntryContributions["carriedEntries"]>[number];
const snapshotSchema = z.object({
  templateObservationId: z.string().optional(),
  semantic: z.object({
    carriedEntries: z.array(z.object({
      entryId: z.string(), creditBatchId: z.string(), componentId: z.string(),
      occurredOn: z.string(), value: z.object({ magnitude: z.string(), unit: z.string() }),
      evidenceDocumentIds: z.array(z.string()), earlierRemovalId: z.string().optional(),
    })).default([]),
  }),
});

/** Entry-only sheet read; sent values are frozen and only display labels are hydrated. */
export async function loadRemovalCarriedEntries(ctx: OrgContext, removalId: string): Promise<RemovalCarriedEntry[]> {
  requireOrgScope(ctx);
  const removal = await getCertifierRemovalById(ctx, removalId);
  if (!removal) throw new SafeError("Removal was not found.");
  const sent = await getSentRemovalForComparison(ctx, removalId);
  if (!sent) return loadDraftRemovalCarriedEntries(ctx, removalId, removal.facilityId);
  const parsed = snapshotSchema.safeParse(sent.payloadSnapshot);
  if (!parsed.success) throw new DomainError("validation_failed", "The saved emissions entry set could not be read. Refresh the Removal before submitting.");
  const snapshot = parsed.data;
  const entries = snapshot.semantic.carriedEntries;
  if (!entries.length) return [];
  const earlier = new Map(entries.map(entry => [entry.entryId, entry.earlierRemovalId]));
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
    const earlierRemovalId = earlier.get(entry.entryId);
    return { entryId: entry.entryId, creditBatchId: entry.creditBatchId, creditBatchCode: batch?.code ?? entry.creditBatchId,
      componentId: entry.componentId, componentName: (observation ? entryLine(observation, entry.componentId)?.component.displayName : undefined),
      occurredOn: entry.occurredOn, value: entry.value, evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
      earlierRemovalId, earlierRemovalCode: earlierRemovalId ? codes.get(earlierRemovalId) : undefined,
    };
  }).sort((a, b) => a.entryId.localeCompare(b.entryId));
}
