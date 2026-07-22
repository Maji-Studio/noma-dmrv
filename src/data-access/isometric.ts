import { and, count, eq, gte, lt } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, productionProcesses, samples } from "@/db/schema";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

// Re-exported for existing consumers that import the threshold from this module.
export { METHOD_B_MINIMUM_METHOD_A_SAMPLES };

type Executor = DbTransaction | typeof db;

export type MethodBEligibilitySummary = {
  priorMethodASampleCount: number;
  minimumMethodASampleCount: number;
  meetsMinimumMethodASamples: boolean;
  isEligible: boolean;
};

/**
 * Canonical eligible-replicate counter for Method-B baseline progress. It is
 * keyed by production process so operator surfaces, unlock validation, and the
 * eventual Track-2 transactional backstop consume the same SQL definition.
 *
 * Both time bounds of the baseline window are enforced here (ADR 0017,
 * 2026-07-12 process-start amendment): `samplingTime >= established_at` — a
 * back-entered process never counts samples dated before its operational start
 * — and, when `asOfDate` is given, `samplingTime < asOfDate` (the pre-unlock /
 * as-of-now upper bound). The DB trigger (`process_method_b_minimum_samples`)
 * re-asserts the same window against direct SQL.
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

/**
 * Count the eligible replicate samples a PRODUCTION PROCESS (the
 * (facility, feedstock) campaign) has accumulated toward its Method-B baseline,
 * and judge whether it clears the ≥ 30-sample bar (`G-F74T-0`).
 *
 * Grain correction (ADR 0017 Track 1): the count is scoped to the production
 * process via `credit_batches.production_process_id` — NOT the reactor. A
 * reactor runs multiple feedstocks; counting a reactor's samples pooled (say)
 * hardwood replicates toward a softwood batch's eligibility — a latent
 * cross-feedstock OVER-CREDIT bug. Scoping to the process isolates each
 * feedstock's baseline.
 *
 * The window is `established_at <= samplingTime < asOfDate`: process-id scoping
 * keeps prior processes' samples out (a feedstock or pyrolysis-condition change
 * opens a NEW process whose baseline restarts from zero), and the explicit
 * `established_at` lower bound excludes samples dated before a back-entered
 * process's operational start (ADR 0017, 2026-07-12 amendment). Only
 * credit-batch-linked samples count — in-process samples are internal-only
 * (ADR 0016) and the inner join drops the null-`creditBatchId` rows. `asOfDate`
 * bounds the count to samples taken before a given batch's production.
 *
 * This is the LIFETIME baseline counter (≥ 30 unlock eligibility), distinct
 * from the trailing-6-month eligible/borrow pool that feeds the unsampled
 * estimate (Eq 4/5) — see CONTEXT.md "Eligible sample".
 */
export async function getMethodBEligibilityByProcess(
  ctx: OrgContext,
  params: {
    productionProcessId: string;
    asOfDate?: Date;
  }
): Promise<MethodBEligibilitySummary> {
  requireOrgScope(ctx);

  const [process] = await db
    .select({ facilityId: productionProcesses.facilityId })
    .from(productionProcesses)
    .where(and(eq(productionProcesses.id, params.productionProcessId), eq(productionProcesses.organizationId, ctx.organizationId)))
    .limit(1);

  const countsByProcess = process
    ? await countEligibleSamplesByProcess(ctx, db, {
        facilityId: process.facilityId,
        asOfDate: params.asOfDate,
      })
    : new Map<string, number>();

  const priorMethodASampleCount =
    countsByProcess.get(params.productionProcessId) ?? 0;

  const meetsMinimumMethodASamples =
    priorMethodASampleCount >= METHOD_B_MINIMUM_METHOD_A_SAMPLES;

  return {
    priorMethodASampleCount,
    minimumMethodASampleCount: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
    meetsMinimumMethodASamples,
    isEligible: meetsMinimumMethodASamples,
  };
}
