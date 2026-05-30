import { env } from "@/config/env";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { SafeError } from "@/lib/errors";
import { IsometricApiError, type TransportLegsByCategory } from "@/lib/isometric";
import type { TransportEntityIdsByCategory } from "@/lib/isometric/utils/transport-lineage";

export type { TransportLegsByCategory };

export const ISOMETRIC_PROVIDER = "isometric" as const;
export const REMOVAL_SUBMISSION_TYPE = "removal" as const;
// The Removal ledger row is keyed localEntityType='removal', localEntityId=
// certifierRemovals.id. N credit batches map into one removal.
export const REMOVAL_ENTITY_TYPE = "removal" as const;
// GHG-statement constants. A GHG Statement is an independent, period-anchored
// artifact (ADR 0003 / Phase 4.5); its ledger row is keyed
// (provider, 'ghg_statement', 'ghgStatement', certifierGhgStatements.id).
export const GHG_STATEMENT_SUBMISSION_TYPE = "ghg_statement" as const;
export const GHG_STATEMENT_ENTITY_TYPE = "ghgStatement" as const;

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
