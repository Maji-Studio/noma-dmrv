import { and, count, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, samples } from "@/db/schema";

const METHOD_B_MINIMUM_METHOD_A_SAMPLES = 30;
const METHOD_B_CADENCE_DENOMINATOR = 10;

export type MethodBEligibilitySummary = {
  priorMethodASampleCount: number;
  minimumMethodASampleCount: number;
  reportingPeriodRunCount: number;
  reportingPeriodSampledRunCount: number;
  minimumReportingPeriodSampledRunCount: number;
  meetsMinimumMethodASamples: boolean;
  meetsMethodBCadence: boolean;
  isEligible: boolean;
};

export async function getMethodBEligibilityByReactor(params: {
  reactorId: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
}): Promise<MethodBEligibilitySummary> {
  const [priorSampleCountRow] = await db
    .select({
      sampleCount: count(samples.id).mapWith(Number),
    })
    .from(productionRuns)
    .leftJoin(samples, eq(samples.productionRunId, productionRuns.id))
    .where(
      and(
        eq(productionRuns.reactorId, params.reactorId),
        lt(productionRuns.date, params.reportingPeriodStart)
      )
    );

  const [reportingPeriodCountsRow] = await db
    .select({
      runCount: count(productionRuns.id).mapWith(Number),
      sampledRunCount:
        sql<number>`count(distinct case when ${samples.id} is not null then ${productionRuns.id} end)`.mapWith(
          Number
        ),
    })
    .from(productionRuns)
    .leftJoin(samples, eq(samples.productionRunId, productionRuns.id))
    .where(
      and(
        eq(productionRuns.reactorId, params.reactorId),
        gte(productionRuns.date, params.reportingPeriodStart),
        lte(productionRuns.date, params.reportingPeriodEnd)
      )
    );

  const priorMethodASampleCount = priorSampleCountRow?.sampleCount ?? 0;
  const reportingPeriodRunCount = reportingPeriodCountsRow?.runCount ?? 0;
  const reportingPeriodSampledRunCount =
    reportingPeriodCountsRow?.sampledRunCount ?? 0;

  const minimumReportingPeriodSampledRunCount =
    reportingPeriodRunCount === 0
      ? 0
      : Math.ceil(reportingPeriodRunCount / METHOD_B_CADENCE_DENOMINATOR);

  const meetsMinimumMethodASamples =
    priorMethodASampleCount >= METHOD_B_MINIMUM_METHOD_A_SAMPLES;
  const meetsMethodBCadence =
    reportingPeriodRunCount === 0 ||
    reportingPeriodSampledRunCount >= minimumReportingPeriodSampledRunCount;

  return {
    priorMethodASampleCount,
    minimumMethodASampleCount: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
    reportingPeriodRunCount,
    reportingPeriodSampledRunCount,
    minimumReportingPeriodSampledRunCount,
    meetsMinimumMethodASamples,
    meetsMethodBCadence,
    isEligible: meetsMinimumMethodASamples && meetsMethodBCadence,
  };
}
