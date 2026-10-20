import { and, eq, isNull } from "drizzle-orm";
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
import { reviewLineSources } from "@/lib/certification/removal-template-review-sources";
import { compareTemplateObservations, enrichmentProblems, lineNeedsReview, validateLineSources } from "@/lib/isometric/template-observations";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ApplyRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";
import { requireOrgScope } from "./utils";
import { acquireFacilityCertificationBoundaryLock } from "./facility-certification-boundary-lock";
import { acquireTemplateObservationLock, getLatestTemplateObservation, reviewLineContractsInTransaction } from "./removal-template-observations";
import { updateFacilityDefaultRemovalTemplateInTransaction } from "./certification";
import { switchCreditBatchRemovalTemplateInTransaction } from "./credit-batch-removal-template";
import { staleRowVersion } from "./row-version";

export function staleSetupTemplate(templateId: string) {
  return new DomainError("stale_version", "The template changed in Isometric. Review it again.", {
    conflict: { entity: "removal_template_observation", id: templateId, code: STALE_VERSION_CONFLICT_CODE },
  });
}

export async function listSetupCreditBatches(ctx: OrgContext, facilityId: string) {
  requireOrgScope(ctx);
  return db.select({ id: creditBatches.id, code: creditBatches.code, version: creditBatches.version, removalTemplateId: creditBatches.removalTemplateId })
    .from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId), isNull(creditBatches.archivedAt)));
}

/** All setup mutations share this transaction. Locks: boundary, observation, batches. */
export async function applySetupInTransaction(ctx: OrgContext, tx: DbTransaction, input: ApplyRemovalTemplateSetupInput,
  template: IsometricGhgEntryTemplate, observed: RemovalTemplateObservation, previous: RemovalTemplateObservation | null) {
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
  const plan = setupPlan(row.definition, sources, validateLineSources(row.definition, row.lineSources), previous ? compareTemplateObservations(previous, row) : {});
  const assignments = assignmentsFromPlan(plan, input.answers, input.overrides);
  if (Object.keys(assignments).length) row = await reviewLineContractsInTransaction(ctx, tx, { observationId: row.id, expectedVersion: row.version, assignments });
  const reviewedSources = reviewLineSources(row.lineSources);
  const problems = validateLineSources(row.definition, row.lineSources);
  if (row.definition.groups.some((group) => group.components.some((component) => lineNeedsReview(component.id, reviewedSources[component.id], problems)))) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview);
  if (enrichmentProblems(row.definition, row.enrichment).length) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
  if (input.makeDefault) await updateFacilityDefaultRemovalTemplateInTransaction(ctx, tx, { facilityId: input.facilityId, externalProjectId: template.project_id, removalTemplateId: template.id });
  for (const selected of [...input.batches].sort((a, b) => a.id.localeCompare(b.id))) {
    const [batch] = await tx.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, selected.id), eq(creditBatches.facilityId, input.facilityId)));
    if (!batch) throw new SafeError("Credit batch not found in this facility.");
    if (batch.removalTemplateId) throw staleRowVersion("creditBatch", batch.id);
    await switchCreditBatchRemovalTemplateInTransaction(ctx, tx, { creditBatchId: batch.id, expectedVersion: selected.expectedVersion, removalTemplateId: template.id }, { facilityId: input.facilityId, requireUnpinned: true });
  }
  return { removalTemplateId: template.id, batchesUpdated: input.batches.length };
}
