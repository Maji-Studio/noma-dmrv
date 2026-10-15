/**
 * Application create, update and delete share one lock sequence:
 * 1. Discover the application, old/new deliveries, facilities, saved provenance
 *    runs plus current-share runs, and linked or slice-owning batches unlocked.
 * 2. Lock the sorted union of lineage artifacts (create: delivery; update:
 *    application and new delivery; delete: application).
 * 3. Facilities FOR SHARE, sorted.
 * 4. Production runs FOR SHARE, sorted.
 * 5. Credit batches FOR SHARE, sorted.
 * 6. Deliveries FOR UPDATE, sorted.
 * 7. Application FOR UPDATE and expected-version check.
 * 8. Revalidate lineage, delivery identity, facility, run and batch sets.
 *    A changed set is retryable conflict; never acquire a newly found lock late.
 * 9. Application credit_batch_applications rows FOR UPDATE, sorted.
 * 10. Write the application, shares and slices, or retire documents on delete.
 *
 * Documents take artifacts, delivery SHARE, application SHARE in the same order.
 * Facility archive and Removal create serialize at the facility before any of
 * their child locks. Delivery writes/corrections take artifacts before delivery;
 * applications take no topology, bin or product UPDATE locks, so their run FK
 * KEY SHARE locks are compatible with our SHARE locks. Allocation saving only
 * re-locks our delivery/application; slice reconciliation touches this app only.
 * No transport topology lock: Removal transport is derived from frozen slices.
 *
 * Explicit membership writers also take artifacts, facilities SHARE, runs
 * UPDATE, then process scope and batch UPDATE. They serialize with our run
 * SHARE before either writer reaches batch/application locks or slice FK checks.
 * Production-run auto-attachment retains the recorded row-before-artifact residual.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applications, applicationOutputAllocations, creditBatchApplications, creditBatchProductionRuns, creditBatches, deliveries, facilities, outputStockAllocations, outputStockRunAllocations, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import { assertLockedLineagesAllowMutation, CertificationLineageChangedError, lockCertifiedLineageArtifacts, type CertifiedLineageCheck } from "./certification-lineage-guards";
import { assertRowVersion } from "./row-version";
import { requireOrgScope } from "./utils";

const sorted = (ids: string[]) => [...new Set(ids)].sort();
function changed(pointer: string): never {
  throw new DomainError("conflict", "Application sources changed. Refresh and try again.", { retryable: true, issues: [{ path: [pointer], code: "conflict", message: "Application sources changed. Refresh and try again." }] });
}
export function applicationNotFound(entity: "application" | "delivery"): DomainError {
  const message = entity === "application" ? "Application not found" : "Delivery not found";
  return new DomainError("not_found", message, { issues: [{ path: [`${entity}Id`], code: "not_found", message }] });
}
async function discover(ctx: OrgContext, tx: DbTransaction, deliveryIds: string[], applicationId?: string) {
  requireOrgScope(ctx);
  const deliveryRows = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), inArray(deliveries.id, deliveryIds))).orderBy(deliveries.id);
  if (deliveryRows.length !== deliveryIds.length) throw applicationNotFound("delivery");
  const provenance = await tx.select({ id: outputStockRunAllocations.productionRunId }).from(outputStockAllocations)
    .innerJoin(outputStockRunAllocations, and(eq(outputStockRunAllocations.allocationId, outputStockAllocations.id), eq(outputStockRunAllocations.organizationId, ctx.organizationId)))
    .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), inArray(outputStockAllocations.deliveryId, deliveryIds)));
  const shares = applicationId ? await tx.select({ id: applicationOutputAllocations.productionRunId }).from(applicationOutputAllocations)
    .where(and(eq(applicationOutputAllocations.organizationId, ctx.organizationId), eq(applicationOutputAllocations.applicationId, applicationId))) : [];
  const runIds = sorted([...provenance, ...shares].map(row => row.id));
  const links = runIds.length ? await tx.select({ id: creditBatchProductionRuns.creditBatchId, runId: creditBatchProductionRuns.productionRunId }).from(creditBatchProductionRuns)
    .where(and(eq(creditBatchProductionRuns.organizationId, ctx.organizationId), inArray(creditBatchProductionRuns.productionRunId, runIds))) : [];
  const slices = applicationId ? await tx.select({ id: creditBatchApplications.creditBatchId }).from(creditBatchApplications)
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.applicationId, applicationId))) : [];
  const applicationBatchIds = sorted([...links.filter(link => shares.some(share => share.id === link.runId)), ...slices].map(row => row.id));
  return { applicationBatchIds, deliveryRows, facilityIds: sorted(deliveryRows.map(row => row.facilityId)), runIds, batchIds: sorted([...links, ...slices].map(row => row.id)) };
}
export async function lockApplicationWriteScope(ctx: OrgContext, tx: DbTransaction, input: {
  mutation: "create" | "update" | "delete"; applicationId?: string; deliveryId?: string; expectedVersion?: number;
}) {
  requireOrgScope(ctx);
  const [snapshot] = input.applicationId ? await tx.select().from(applications)
    .where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.id, input.applicationId))) : [];
  if (input.applicationId && !snapshot) throw applicationNotFound("application");
  const deliveryIds = sorted([snapshot?.deliveryId, input.deliveryId].filter((id): id is string => !!id));
  const discovered = await discover(ctx, tx, deliveryIds, input.applicationId);
  const checks: CertifiedLineageCheck[] = snapshot ? [{ target: { entityType: "application", entityId: snapshot.id }, mutation: input.mutation }] : [];
  if (input.deliveryId && input.deliveryId !== snapshot?.deliveryId) checks.push({ target: { entityType: "delivery", entityId: input.deliveryId }, mutation: input.mutation, subjectEntityType: "application", ...(snapshot ? { lineageRelationship: "selected" as const } : {}) });
  const path = [snapshot ? "applicationId" : "deliveryId"];
  const artifacts = await withFeedstockErrors(() => lockCertifiedLineageArtifacts(ctx, tx, checks.map(check => check.target)), "certification_locked", path);
  const facilityRows = await tx.select().from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), inArray(facilities.id, discovered.facilityIds))).orderBy(facilities.id).for("share");
  if (discovered.runIds.length) await tx.select({ id: productionRuns.id }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), inArray(productionRuns.id, discovered.runIds))).orderBy(productionRuns.id).for("share");
  const batches = discovered.batchIds.length ? await tx.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.id, discovered.batchIds))).orderBy(creditBatches.id).for("share") : [];
  const deliveryRows = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), inArray(deliveries.id, deliveryIds))).orderBy(deliveries.id).for("update");
  const [application] = input.applicationId ? await tx.select().from(applications).where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.id, input.applicationId))).for("update") : [];
  if (input.applicationId) {
    if (!application) throw applicationNotFound("application");
    assertRowVersion({ entity: "application", id: application.id, expectedVersion: input.expectedVersion!, actualVersion: application.version });
    if (application.deliveryId !== snapshot?.deliveryId) changed("applicationId");
  }
  for (const check of checks) await withFeedstockErrors(async () => {
    try { await assertLockedLineagesAllowMutation(ctx, tx, artifacts, [check]); }
    catch (error) { if (error instanceof CertificationLineageChangedError) changed(check.target.entityType === "delivery" ? "deliveryId" : "applicationId"); throw error; }
  }, "certification_locked", [check.target.entityType === "delivery" ? "deliveryId" : "applicationId"]);
  const current = await discover(ctx, tx, deliveryIds, input.applicationId);
  for (const key of ["facilityIds", "runIds", "batchIds", "applicationBatchIds"] as const) if (JSON.stringify(current[key]) !== JSON.stringify(discovered[key])) changed(path[0]);
  if (deliveryRows.some(row => row.facilityId !== discovered.deliveryRows.find(before => before.id === row.id)?.facilityId)) changed("deliveryId");
  const slices = input.applicationId ? await tx.select().from(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.applicationId, input.applicationId))).orderBy(creditBatchApplications.id).for("update") : [];
  return { application, deliveries: deliveryRows, facilities: facilityRows, batches: batches.filter(batch => current.applicationBatchIds.includes(batch.id)), slices };
}
