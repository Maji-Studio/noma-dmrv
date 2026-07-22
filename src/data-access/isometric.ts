import { and, count, eq, gte, lt } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, productionProcesses, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

type Executor = DbTransaction | typeof db;

/**
 * Canonical eligible-replicate counter for Method-B baseline progress. It is
 * keyed by production process so eligibility reads and credit-batch creation
 * consume the same SQL definition.
 *
 * Both time bounds of the baseline window are enforced here (ADR 0022):
 * `samplingTime >= established_at` — a
 * back-entered process never counts samples dated before its operational start
 * — and, when `asOfDate` is given, `samplingTime < asOfDate`. Only sampled
 * batches contribute to the baseline. Eligibility is deliberately computed at
 * read time; there is no stored unlock or DB trigger.
 */
export async function countEligibleSamplesByProcess(
  ctx: OrgContext,
  executor: Executor,
  params: { facilityId: string; asOfDate?: Date },
): Promise<Map<string, number>> {
  requireOrgScope(ctx);
  const conditions = [
    eq(creditBatches.facilityId, params.facilityId),
    eq(creditBatches.organizationId, ctx.organizationId),
    eq(creditBatches.sampling, "sampled"),
    eq(samples.organizationId, ctx.organizationId),
    gte(samples.samplingTime, productionProcesses.establishedAt),
  ];
  if (params.asOfDate) {
    conditions.push(lt(samples.samplingTime, params.asOfDate));
  }

  const rows = await executor
    .select({
      productionProcessId: creditBatches.productionProcessId,
      sampleCount: count(samples.id).mapWith(Number),
    })
    .from(samples)
    .innerJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
    .innerJoin(
      productionProcesses,
      and(
        eq(productionProcesses.id, creditBatches.productionProcessId),
        eq(productionProcesses.organizationId, ctx.organizationId),
      ),
    )
    .where(and(...conditions))
    .groupBy(creditBatches.productionProcessId);

  return new Map(
    rows.map((row) => [row.productionProcessId, row.sampleCount] as const),
  );
}
