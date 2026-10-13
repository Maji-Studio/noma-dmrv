import type { DbTransaction } from "@/db";
import { samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";
import { assertCarbonReconciliation } from "./carbon-reconciliation";
import { assertSamplingTimeNotFuture } from "./future-time";
import { getSampleById } from "./sample-by-id";
import { derivedRatioColumns, entryWarnings, optionalColumns, type CreateSampleRequest, type EffectiveSampleValues, type SampleWriteResult } from "./write-values";
import {
  assertBatchTierEvidence, lockSampleWriteScope, readSampleBatchFacility, requireWritableBatch, resolveSamplingTimeForBatch,
} from "./write-scope";

/**
 * Create a lab Sample inside the caller's transaction (the operation runner's,
 * or the savepoint `withAutoCodes` opens per code attempt). The batch is
 * locked after its artifacts and every check reads the locked batch; see
 * `write-scope.ts` for the order. H/C_org and O/C_org are derived here, never
 * taken from the caller (round 7 Q50). Code uniqueness is the database's: the
 * caller maps a collision.
 */
export async function createSampleInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  request: CreateSampleRequest,
  options: { now?: Date } = {},
): Promise<SampleWriteResult> {
  requireOrgScope(ctx);
  const scope = await lockSampleWriteScope(ctx, tx, {
    lineage: [{ target: { entityType: "creditBatch", entityId: request.creditBatchId }, mutation: "create", subjectEntityType: "sample" }],
    creditBatchIds: [request.creditBatchId],
  });
  const batch = requireWritableBatch(scope, request.creditBatchId);
  const facility = await readSampleBatchFacility(ctx, tx, batch);
  const samplingTime = resolveSamplingTimeForBatch(request.samplingTime, batch, facility);
  assertSamplingTimeNotFuture(samplingTime, options.now ?? new Date());

  const effective: EffectiveSampleValues = {
    sampleCode: request.sampleCode,
    totalCarbonPercent: request.totalCarbonPercent,
    organicCarbonPercent: request.organicCarbonPercent,
    inorganicCarbonPercent: request.inorganicCarbonPercent ?? null,
    totalHydrogenPercent: request.totalHydrogenPercent ?? null,
    totalOxygenPercent: request.totalOxygenPercent ?? null,
    moistureContentPercent: request.moistureContentPercent ?? null,
    oToCOrgRatio: request.oToCOrgRatio ?? null,
    randomReflectanceR0Percent: request.randomReflectanceR0Percent ?? null,
    sReflectanceFraction: request.sReflectanceFraction ?? null,
    r0MeasurementCount: request.r0MeasurementCount ?? null,
    reactiveCarbonPercent: request.reactiveCarbonPercent ?? null,
    residualCarbonPercent: request.residualCarbonPercent ?? null,
  };
  assertCarbonReconciliation(effective, {});
  assertBatchTierEvidence(facility, effective);
  const ratios = derivedRatioColumns(effective);

  const [created] = await tx
    .insert(samples)
    .values({
      ...optionalColumns(request, true),
      ...ratios.columns,
      organizationId: ctx.organizationId,
      sampleCode: request.sampleCode,
      creditBatchId: batch.id,
      samplingTime,
      totalCarbonPercent: request.totalCarbonPercent,
      organicCarbonPercent: request.organicCarbonPercent,
    })
    .returning({ id: samples.id });
  return {
    // Read back inside the transaction, so a failed read never reports a saved sample as missing (issue #769).
    sample: await getSampleById(ctx, created.id, tx),
    notices: ratios.notices,
    warnings: entryWarnings(effective, ratios.columns, batch, facility),
  };
}
