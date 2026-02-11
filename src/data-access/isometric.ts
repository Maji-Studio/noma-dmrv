import { and, count, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, samples } from "@/db/schema";

const METHOD_B_MINIMUM_METHOD_A_SAMPLES = 30;

export type MethodBEligibilitySummary = {
  priorMethodASampleCount: number;
  minimumMethodASampleCount: number;
  meetsMinimumMethodASamples: boolean;
  isEligible: boolean;
};

export async function getMethodBEligibilityByReactor(params: {
  reactorId: string;
  asOfDate?: string;
}): Promise<MethodBEligibilitySummary> {
  const whereClause = params.asOfDate
    ? and(
        eq(productionRuns.reactorId, params.reactorId),
        lt(productionRuns.date, params.asOfDate)
      )
    : eq(productionRuns.reactorId, params.reactorId);

  const [priorSampleCountRow] = await db
    .select({
      sampleCount: count(samples.id).mapWith(Number),
    })
    .from(productionRuns)
    .leftJoin(samples, eq(samples.productionRunId, productionRuns.id))
    .where(whereClause);

  const priorMethodASampleCount = priorSampleCountRow?.sampleCount ?? 0;

  const meetsMinimumMethodASamples =
    priorMethodASampleCount >= METHOD_B_MINIMUM_METHOD_A_SAMPLES;

  return {
    priorMethodASampleCount,
    minimumMethodASampleCount: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
    meetsMinimumMethodASamples,
    isEligible: meetsMinimumMethodASamples,
  };
}
