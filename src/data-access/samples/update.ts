import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SampleFieldError, sampleNotFound } from "@/lib/sample-domain-errors";
import type { CertifiedLineageCheck } from "../certification-lineage-guards";
import { assertRowVersion, nextVersion } from "../row-version";
import { requireOrgScope } from "../utils";
import { assertCarbonReconciliation } from "./carbon-reconciliation";
import { assertSamplingTimeNotFuture } from "./future-time";
import { getSampleById } from "./sample-by-id";
import { derivedRatioColumns, batchEntryWarnings, mergeOverLocked, optionalColumns, type SampleWriteResult, type UpdateSampleRequest } from "./write-values";
import {
  assertSampleLinksHeld, lockSampleWriteScope, readSampleBatchFacility, readSampleLinks,
  requireWritableBatch, resolveSamplingTimeForBatch, type LockedSampleBatch, type SampleBatchFacility,
} from "./write-scope";

const LEGACY_LOCAL_TIME_MESSAGE = "This Sample has no credit batch, so it has no facility clock. Enter the sampling time with a time zone offset.";

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
  options: { now?: Date } = {},
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
  const scope = await lockSampleWriteScope(ctx, tx, { lineage, creditBatchIds: [...links.lineageBatchIds, request.creditBatchId], sampleId });
  const locked = scope.sample;
  if (!locked) throw sampleNotFound();
  assertRowVersion({ entity: "sample", id: sampleId, expectedVersion: request.expectedVersion, actualVersion: locked.version });
  // A link change committed between the read and the lock bumps the version,
  // so this only fires for a caller that already held the newer version.
  await assertSampleLinksHeld(ctx, tx, scope, sampleId, links);
  // Moving off an archived batch is a write on it too (round 7 Q56).
  if (moving && locked.creditBatchId) requireWritableBatch(scope, locked.creditBatchId);

  const effective = mergeOverLocked(locked, request);
  assertCarbonReconciliation(effective, {});
  const ratios = derivedRatioColumns(effective);

  // Legacy batchless rows keep their batch-free behaviour until moved onto a batch.
  const creditBatchId = request.creditBatchId ?? locked.creditBatchId;
  let samplingTime: Date | undefined;
  let warningScope: { batch: LockedSampleBatch; facility: SampleBatchFacility } | undefined;
  if (creditBatchId) {
    const batch = requireWritableBatch(scope, creditBatchId);
    const facility = await readSampleBatchFacility(ctx, tx, batch);
    // Only a new time or a move re-checks the window: a batch edit that moved
    // the window past a stored sample stays allowed and is flagged by readiness (Q55).
    if (request.samplingTime !== undefined || moving) {
      samplingTime = resolveSamplingTimeForBatch(request.samplingTime ?? locked.samplingTime, batch, facility);
    }
    warningScope = { batch, facility };
  } else if (request.samplingTime !== undefined) {
    // No batch, so no facility clock: only an instant can be placed.
    samplingTime = resolveLegacySamplingTime(request.samplingTime);
  }
  if (request.samplingTime !== undefined && samplingTime) assertSamplingTimeNotFuture(samplingTime, options.now ?? new Date());

  await tx.update(samples).set({
    ...optionalColumns(request, false),
    ...ratios.columns,
    ...(request.sampleCode !== undefined ? { sampleCode: request.sampleCode } : {}),
    ...(request.creditBatchId !== undefined ? { creditBatchId: request.creditBatchId } : {}),
    ...(samplingTime && request.samplingTime !== undefined ? { samplingTime } : {}),
    ...(request.totalCarbonPercent !== undefined ? { totalCarbonPercent: request.totalCarbonPercent } : {}),
    ...(request.organicCarbonPercent !== undefined ? { organicCarbonPercent: request.organicCarbonPercent } : {}),
    updatedAt: new Date(),
    version: nextVersion(samples.version),
  }).where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId)));

  return {
    // Read back inside the transaction (issue #769).
    sample: await getSampleById(ctx, sampleId, tx),
    notices: ratios.notices,
    warnings: warningScope
      ? await batchEntryWarnings(ctx, tx, effective, ratios.columns, warningScope.batch, warningScope.facility)
      : [],
  };
}

function resolveLegacySamplingTime(value: NonNullable<UpdateSampleRequest["samplingTime"]>): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  // A facility-local time needs a batch facility's zone; a batchless legacy row has none.
  throw new SampleFieldError(LEGACY_LOCAL_TIME_MESSAGE, "samplingTime");
}
