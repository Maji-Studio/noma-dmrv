import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { EntryContender } from "@/lib/certification/removal-emission-contributions";
import { deriveEntryCorrection } from "@/lib/certification/removal-entry-correction";
import { deriveRemovalEntryInputs } from "@/lib/certification/removal-entry-inputs";
import { requireOrgScope } from "./utils";
import { listEmissionEntryDraftContenders, loadEmissionEntryReservations } from "./emission-entry-contenders";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";
import { getLatestTemplateObservation } from "./removal-template-observations";
import { getCreditBatchesByRemovalId } from "./certifier-removals";

const figure = z.object({ magnitude: z.string(), unit: z.string() });
const manifestSchema = z.array(z.object({ componentId: z.string(), inputKey: z.string(), entries: z.array(z.object({
  entryId: z.string(), creditBatchId: z.string(), occurredOn: z.string().optional(), contentRevision: z.number(),
  kind: z.enum(["value", "zero"]), value: figure, massDistanceDetail: z.object({ mass: figure, distance: figure }).nullable().optional(),
  evidenceDocumentIds: z.array(z.string()),
})) }));

/** Advisory state only. Mutation authorization comes from the locked lineage loader. */
export async function loadRemovalEntryCorrection(ctx: OrgContext, removalId: string, suppliedContenders?: EntryContender[]) {
  requireOrgScope(ctx);
  const closed = deriveEntryCorrection(false, [], []);
  const [submitted] = await db.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.localEntityType, "removal"),
    eq(certificationSubmissions.submissionType, "removal"), eq(certificationSubmissions.provider, "isometric"),
    eq(certificationSubmissions.localEntityId, removalId), isNotNull(certificationSubmissions.submittedAt),
  )).orderBy(desc(certificationSubmissions.version)).limit(1);
  if (!submitted) return closed;
  const batches = await getCreditBatchesByRemovalId(ctx, removalId);
  const ids = batches.map((batch) => batch.id);
  const contenders = suppliedContenders ?? await listEmissionEntryDraftContenders(ctx, ids);
  const correction = contenders.find((item) => item.removalId === removalId && item.contenderKind === "correction");
  if (!correction) return closed;
  const snapshot = z.object({ semantic: z.object({ entryContributions: manifestSchema }) }).safeParse(submitted?.payloadSnapshot);
  const pin = batches[0]?.removalTemplateId;
  const observation = pin ? await getLatestTemplateObservation(ctx, "isometric", pin) : null;
  if (!snapshot.success || !observation) return closed;
  const facts = await Promise.all(ids.map((id) => loadBatchEmissionEntryFacts(ctx, id, observation)));
  const entries = facts.flatMap((fact) => fact.entries);
  const reservations = await loadEmissionEntryReservations(ctx, entries.flatMap((entry) => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []));
  const current = deriveRemovalEntryInputs({ removalId, memberBatchIds: ids, window: correction.window,
    contenders, entries, observation, reservations, nowMs: Date.now() });
  return { ...deriveEntryCorrection(true, snapshot.data.semantic.entryContributions, current.manifest), removalId };
}
