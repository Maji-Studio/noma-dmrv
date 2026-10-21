import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { certificationSubmissions, certifierRemovals, certifierGhgStatements } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { entryInputManifestSchema, type EntryContender } from "@/lib/certification/removal-emission-contributions";
import { deriveEntryCorrection, buildRemovalCorrection, type EntryCorrectionState } from "@/lib/certification/removal-entry-correction";
import { deriveRemovalEntryInputs } from "@/lib/certification/removal-entry-inputs";
import { requireOrgScope } from "./utils";
import { listEmissionEntryDraftContenders, loadEmissionEntryReservations } from "./emission-entry-contenders";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";
import { getLatestTemplateObservation, getTemplateObservationById } from "./removal-template-observations";
import { getCreditBatchesByRemovalId } from "./certifier-removals";

/** Advisory state only. Mutation authorization comes from the locked lineage loader. */
export async function loadRemovalEntryCorrection(ctx: OrgContext, removalId: string, suppliedContenders?: EntryContender[]): Promise<EntryCorrectionState> {
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
  const snapshot = z.object({ semantic: z.object({ entryContributions: z.array(entryInputManifestSchema) }) }).safeParse(submitted?.payloadSnapshot);
  const pin = batches[0]?.removalTemplateId;
  const observation = pin ? await getLatestTemplateObservation(ctx, "isometric", pin) : null;
  if (!snapshot.success || !observation) return closed;
  const facts = await Promise.all(ids.map((id) => loadBatchEmissionEntryFacts(ctx, id, observation)));
  const entries = facts.flatMap((fact) => fact.entries);
  const reservations = await loadEmissionEntryReservations(ctx, entries.flatMap((entry) => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []));
  const current = deriveRemovalEntryInputs({ removalId, memberBatchIds: ids, window: correction.window,
    contenders, entries, observation, reservations, nowMs: Date.now() });
  const state = deriveEntryCorrection(true, snapshot.data.semantic.entryContributions, current.manifest);
  if (!correction.returnedStatement) return { ...state, removalId };
  const [identity] = await db.select({ code: certifierRemovals.code,
    reportingPeriodStartOn: certifierGhgStatements.reportingPeriodStartOn,
    reportingPeriodEndOn: certifierGhgStatements.reportingPeriodEndOn,
  }).from(certifierRemovals)
    .innerJoin(certifierGhgStatements, and(eq(certifierGhgStatements.organizationId, ctx.organizationId),
      eq(certifierGhgStatements.id, correction.returnedStatement.id)))
    .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, removalId)));
  if (!identity) return { ...state, removalId };
  const components = [observation, ...facts.flatMap((fact) => [...fact.previousObservations.values()])]
    .flatMap((item) => item?.definition.groups.flatMap((group) => group.components) ?? []);
  // Deleted entries may have no live row from which to recover a retired component's name.
  const sentPin = z.object({ templateObservationId: z.string() }).safeParse(submitted.payloadSnapshot);
  if (sentPin.success && state.changedComponentIds.some((id) => !components.some((component) => component.id === id))) {
    const sentObservation = await getTemplateObservationById(ctx, sentPin.data.templateObservationId);
    components.push(...(sentObservation?.definition.groups.flatMap((group) => group.components) ?? []));
  }
  return { ...state, removalId, removalCode: identity.code,
    correction: buildRemovalCorrection({ removalId, removalCode: identity.code, state,
      statement: { ...correction.returnedStatement, reportingPeriodStartOn: identity.reportingPeriodStartOn,
        reportingPeriodEndOn: identity.reportingPeriodEndOn },
      batches: batches.map(({ id, code }) => ({ id, code })),
      components,
    }),
  };
}
