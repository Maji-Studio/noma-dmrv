import { env } from "@/config/env";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import type { TransportLeg } from "@/db/schema";
import { SafeError } from "@/lib/errors";
import { IsometricApiError } from "@/lib/isometric";
import type { TransportEntityIdsByCategory } from "@/lib/isometric/utils/transport-lineage";

export const ISOMETRIC_PROVIDER = "isometric" as const;
export const REMOVAL_SUBMISSION_TYPE = "removal" as const;
export const GHG_STATEMENT_SUBMISSION_TYPE = "ghg_statement" as const;
export const CREDIT_BATCH_ENTITY_TYPE = "creditBatch" as const;
export const GHG_PERIOD_ENTITY_TYPE = "ghgPeriod" as const;

export async function safeListIfConfigured<T>(
  call: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof IsometricApiError && err.code === "not_configured") {
      return [];
    }
    throw err;
  }
}

export function assertProductionConfirmed(confirmProduction?: boolean): void {
  if (env.ISOMETRIC_ENVIRONMENT === "production" && !confirmProduction) {
    throw new SafeError(
      "Confirm you want to write to the production Isometric environment.",
    );
  }
}

// Blocks submission to a production Isometric project while the resolved
// template still contains `zeroStub` monitored inputs — placeholder 0
// datapoints for deferred per-reporting-period data noma cannot yet
// supply. Allowed in the sandbox environment, where zero stubs are the
// whole point of end-to-end testing. See docs/open-questions.md →
// isometric/phase-3.7-period-inputs.
export function assertNoZeroStubsInProduction(
  zeroStubInputs: { component: string; inputKey: string }[],
): void {
  if (
    env.ISOMETRIC_ENVIRONMENT !== "production" ||
    zeroStubInputs.length === 0
  ) {
    return;
  }
  const lines = zeroStubInputs
    .map((s) => `  • ${s.component} → ${s.inputKey}`)
    .join("\n");
  throw new SafeError(
    `Cannot submit to a production Isometric project: ${zeroStubInputs.length} template input(s) still emit a placeholder 0 (deferred per-reporting-period data):\n${lines}\nReplace these with real data before submitting to production.`,
  );
}

export interface TransportLegsByCategory {
  feedstock: TransportLeg[];
  biochar: TransportLeg[];
  sample: TransportLeg[];
}

export async function loadTransportLegsByCategory(
  userId: string,
  entityIds: TransportEntityIdsByCategory,
): Promise<TransportLegsByCategory> {
  const [feedstock, biochar, sample] = await Promise.all([
    getTransportLegsForEntities(userId, "feedstock", entityIds.feedstockIds),
    getTransportLegsForEntities(userId, "biochar", entityIds.biocharProductIds),
    getTransportLegsForEntities(userId, "sample", entityIds.sampleIds),
  ]);
  return { feedstock, biochar, sample };
}
