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
