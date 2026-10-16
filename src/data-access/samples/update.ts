import { readRecordDependents } from "../record-lock-dependents";
import { assertRecordLockFields } from "@/lib/record-lock-fields";
import { recordLocks } from "@/lib/record-lock";
import type { CaptureActivity } from "@/lib/activity-changes";
import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { sampleNotFound } from "@/lib/sample-domain-errors";
import type { CertifiedLineageCheck } from "../certification-lineage-guards";
import { assertRowVersion, nextVersion } from "../row-version";
import { requireOrgScope } from "../utils";
import { assertCarbonReconciliation } from "./carbon-reconciliation";
import { assertSamplingTimeNotFuture } from "./future-time";
import { getSampleById } from "./sample-by-id";
import { derivedRatioColumns, batchEntryWarnings, mergeOverLocked, optionalColumns, type SampleWriteResult, type UpdateSampleRequest } from "./write-values";
import {
  assertSampleLinksHeld, lockSampleWriteScope, readSampleBatchFacility, readSampleLinks,
  requireWritableBatch, resolveSamplingTimeForBatch,
} from "./write-scope";


/**
 * Update a lab Sample inside the caller's transaction. Every check runs on
 * the update merged over the LOCKED row, never a pre-transaction snapshot:
 * two concurrent partial edits (one clearing R₀, one clearing the S fraction)
 * must each see the other's result. Ratios are recomputed from that merged
 * row on every update. A move locks and guards both batches; the Sample's
 * batch, old or new, must not be archived (round 7 Q56).
 */
export async function updateSampleInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  sampleId: string,
  request: UpdateSampleRequest,
  options: { now?: Date; capture?: CaptureActivity } = {},
): Promise<SampleWriteResult> {
  requireOrgScope(ctx);
  // Unlocked read for the batches to lock; the locked row below is authoritative.
  const links = await readSampleLinks(ctx, tx, sampleId);
  if (!links) throw sampleNotFound();
  const moving = request.creditBatchId !== undefined && request.creditBatchId !== links.creditBatchId;
  const lineage: CertifiedLineageCheck[] = [{ target: { entityType: "sample", entityId: sampleId }, mutation: "update" }];
  // Moving a sample onto a batch that is already part of a submitted artifact
  // would silently change certified chemistry, so the target batch is guarded too.
  if (moving) {
    lineage.push({ target: { entityType: "creditBatch", entityId: request.creditBatchId! }, mutation: "update", subjectEntityType: "sample", lineageRelationship: "selected" });
  }
  const scope = await lockSampleWriteScope(ctx, tx, { lineage, creditBatchIds: [links.creditBatchId, request.creditBatchId], sampleId });
  const locked = scope.sample;
  if (!locked) throw sampleNotFound();
  assertRowVersion({ entity: "sample", id: sampleId, expectedVersion: request.expectedVersion, actualVersion: locked.version });
  // A link change committed between the read and the lock bumps the version,
  // so this only fires for a caller that already held the newer version.
  assertSampleLinksHeld(scope, sampleId, links);
  // Moving off an archived batch is a write on it too (round 7 Q56).
  if (moving) requireWritableBatch(scope, locked.creditBatchId);

  assertRecordLockFields(recordLocks.sample({ removals: [], dependents: await readRecordDependents(ctx, tx, { entityType: "sample", entityId: sampleId }) }), locked, Object.fromEntries(Object.entries(request).filter(([key]) => key !== "expectedVersion")));
  const effective = mergeOverLocked(locked, request);
  assertCarbonReconciliation(effective, {});
  const ratios = derivedRatioColumns(effective);

  const creditBatchId = request.creditBatchId ?? locked.creditBatchId;
  const batch = requireWritableBatch(scope, creditBatchId);
  const facility = await readSampleBatchFacility(ctx, tx, batch);
  // Only a new time or move re-checks the window; readiness flags stored samples.
  let samplingTime: Date | undefined;
  if (request.samplingTime !== undefined || moving) {
    samplingTime = resolveSamplingTimeForBatch(request.samplingTime ?? locked.samplingTime, batch, facility);
  }
  if (request.samplingTime !== undefined && samplingTime) assertSamplingTimeNotFuture(samplingTime, options.now ?? new Date());

  const [saved] = await tx.update(samples).set({
    ...optionalColumns(request, false),
    ...ratios.columns,
    ...(request.sampleCode !== undefined ? { sampleCode: request.sampleCode } : {}),
    ...(request.creditBatchId !== undefined ? { creditBatchId: request.creditBatchId } : {}),
    ...(samplingTime && request.samplingTime !== undefined ? { samplingTime } : {}),
    ...(request.totalCarbonPercent !== undefined ? { totalCarbonPercent: request.totalCarbonPercent } : {}),
    ...(request.organicCarbonPercent !== undefined ? { organicCarbonPercent: request.organicCarbonPercent } : {}),
    updatedAt: new Date(),
    version: nextVersion(samples.version),
  }).where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId))).returning();
  options.capture?.(sampleId, locked, saved);

  return {
    // Read back inside the transaction (issue #769).
    sample: await getSampleById(ctx, sampleId, tx),
    notices: ratios.notices,
    warnings: await batchEntryWarnings(ctx, tx, effective, ratios.columns, batch, facility),
  };
}
