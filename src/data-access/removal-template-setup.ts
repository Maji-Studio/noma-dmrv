import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { facilities } from "@/db/schema/facilities";
import { creditBatches } from "@/db/schema/credits";
import { certifierProjects } from "@/db/schema/certification";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { STALE_VERSION_CONFLICT_CODE } from "@/lib/stale-version";
import { DomainError } from "@/lib/domain-errors";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { assignmentsFromPlan, setupPlan, templateFitsFacility } from "@/lib/certification/removal-template-setup-plan";
import { removalTemplateReviewEntry } from "@/lib/certification/removal-template-review-entry";
import { removalTemplateVerdict } from "@/lib/certification/removal-template-verdict";
import { setupPlanFingerprint } from "@/lib/certification/removal-template-setup-fingerprint";
import { reviewLineSources } from "@/lib/certification/removal-template-review-sources";
import { validateLineSources } from "@/lib/isometric/template-observations";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ApplyRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";
import { requireOrgScope } from "./utils";
import { acquireFacilityCertificationBoundaryLock } from "./facility-certification-boundary-lock";
import { acquireTemplateObservationLock, getLatestTemplateObservation, reviewLineContractsInTransaction } from "./removal-template-observations";
import { updateFacilityRemovalTemplateInTransaction } from "./certification";
import { switchCreditBatchRemovalTemplateInTransaction } from "./credit-batch-removal-template";
import { readCreditBatchMembershipSubmissionLock } from "./credit-batch-certification-lock";
import { getCertifiedLineage, isSubmittedLineageRow } from "./certification-lineage-guards";
import type { TemplateKeptReason } from "./credit-batch-removal-template";

export function staleSetupTemplate(templateId: string) {
  return new DomainError("stale_version", "The template changed in Isometric. Review it again.", {
    conflict: { entity: "removal_template_observation", id: templateId, code: STALE_VERSION_CONFLICT_CODE },
  });
}

export async function listSetupCreditBatches(ctx: OrgContext, facilityId: string) {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    const batches = await tx.select({ id: creditBatches.id, code: creditBatches.code, version: creditBatches.version,
      removalTemplateId: creditBatches.removalTemplateId, archivedAt: creditBatches.archivedAt })
      .from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId))).orderBy(creditBatches.id);
    const result = [];
    for (const batch of batches) {
      let reason: TemplateKeptReason | null = null;
      if (batch.archivedAt) reason = "archived";
      else if (await readCreditBatchMembershipSubmissionLock(ctx, tx, batch.id)) reason = "removalSent";
      else if ((await getCertifiedLineage(ctx, tx, { entityType: "creditBatch", entityId: batch.id })).some(isSubmittedLineageRow)) reason = "certified";
      result.push({ ...batch, reason });
    }
    return result;
  });
}

/** All setup mutations share this transaction. Locks: boundary, observation, batches. */
export async function applySetupInTransaction(ctx: OrgContext, tx: DbTransaction, input: ApplyRemovalTemplateSetupInput,
  template: IsometricGhgEntryTemplate, observed: RemovalTemplateObservation) {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  await acquireFacilityCertificationBoundaryLock(ctx, tx, input.facilityId);
  const [facility] = await tx.select().from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, input.facilityId))).for("share");
  if (!facility || facility.archivedAt) throw new SafeError("Facility not found or archived.");
  const fit = templateFitsFacility(template, facility.durabilityOption);
  if ("reason" in fit) throw new SafeError(fit.reason);
  const [mapping] = await tx.select().from(certifierProjects).where(and(eq(certifierProjects.organizationId, ctx.organizationId), eq(certifierProjects.facilityId, input.facilityId), eq(certifierProjects.provider, "isometric"))).for("share");
  if (!mapping || mapping.externalProjectId !== template.project_id) throw new SafeError("The facility's Isometric project link changed. Refresh and try again.");
  await acquireTemplateObservationLock(ctx, tx, "isometric", template.id);
  let row = await getLatestTemplateObservation(ctx, "isometric", template.id, tx);
  if (!row || row.id !== observed.id || row.version !== observed.version || row.semanticFingerprint !== input.fingerprints.semanticFingerprint || row.fullFingerprint !== input.fingerprints.fullFingerprint) throw staleSetupTemplate(template.id);
  const sources = reviewLineSources(row.lineSources);
  const plan = setupPlan(row.definition, sources, validateLineSources(row.definition, row.lineSources));
  if (setupPlanFingerprint(plan) !== input.planFingerprint) throw staleSetupTemplate(template.id);
  const assignments = assignmentsFromPlan(plan, input.answers, input.overrides);
  if (Object.keys(assignments).length) row = await reviewLineContractsInTransaction(ctx, tx, { observationId: row.id, expectedVersion: row.version, assignments });
  const verdict = removalTemplateVerdict(removalTemplateReviewEntry({ templateId: template.id, template, observation: row }));
  if (verdict.toDecideCount > 0) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview);
  if (verdict.setupBlocker) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS[verdict.setupBlocker]);
  await updateFacilityRemovalTemplateInTransaction(ctx, tx, { facilityId: input.facilityId, externalProjectId: template.project_id, removalTemplateId: template.id });
  // The server enumerates the whole facility. The snapshot is only a concurrency precondition.
  const batches = await tx.select().from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, input.facilityId),
  )).orderBy(creditBatches.id);
  const versions = new Map(input.batchVersions.map((batch) => [batch.id, batch]));
  let batchesUpdated = 0;
  const batchesKept = [];
  for (const batch of batches) {
    if (batch.removalTemplateId === template.id) continue;
    const expected = versions.get(batch.id);
    const result = await switchCreditBatchRemovalTemplateInTransaction(ctx, tx, {
      creditBatchId: batch.id, expectedVersion: expected?.expectedVersion, removalTemplateId: template.id,
    }, { facilityId: input.facilityId, expectedTemplateId: expected ? expected.removalTemplateId : batch.removalTemplateId });
    if (result.status === "updated") batchesUpdated++;
    if (result.status === "kept") batchesKept.push({ id: batch.id, code: batch.code, reason: result.reason });
  }
  return { removalTemplateId: template.id, batchesUpdated, batchesKept };
}
