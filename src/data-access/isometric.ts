import { and, count, eq, lt } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, productionProcesses, samples } from "@/db/schema";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import { requireAuth } from "./utils";

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
 */
export async function countEligibleSamplesByProcess(
  executor: Executor,
  params: { facilityId: string; asOfDate?: Date },
): Promise<Map<string, number>> {
  const conditions = [eq(creditBatches.facilityId, params.facilityId)];
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
 * The process id IS the "since established_at" boundary: a feedstock or
 * pyrolysis-condition change opens a NEW process (new id) whose baseline
 * restarts from zero, so samples of prior processes never leak in. Only
 * credit-batch-linked samples count — in-process samples are internal-only
 * (ADR 0016) and the inner join drops the null-`creditBatchId` rows. `asOfDate`
 * bounds the count to samples taken before a given batch's production.
 *
 * This is the LIFETIME baseline counter (≥ 30 unlock eligibility), distinct
 * from the trailing-6-month eligible/borrow pool that feeds the unsampled
 * estimate (Eq 4/5) — see CONTEXT.md "Eligible sample".
 */
export async function getMethodBEligibilityByProcess(
  userId: string,
  params: {
    productionProcessId: string;
    asOfDate?: Date;
  }
): Promise<MethodBEligibilitySummary> {
  requireAuth(userId);

  const [process] = await db
    .select({ facilityId: productionProcesses.facilityId })
    .from(productionProcesses)
    .where(eq(productionProcesses.id, params.productionProcessId))
    .limit(1);

  const countsByProcess = process
    ? await countEligibleSamplesByProcess(db, {
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
