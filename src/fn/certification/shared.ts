import { env } from "@/config/env";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { SafeError } from "@/lib/errors";
import { IsometricApiError, type TransportLegsByCategory } from "@/lib/isometric";
import type { TransportEntityIdsByCategory } from "@/lib/isometric/utils/transport-lineage";

export type { TransportLegsByCategory };

// Re-exported from the non-server constants module so the existing
// `@/fn/certification/shared` import surface keeps working for the fn/
// layer, while utils that can't cross the "use server" boundary import
// directly from `@/lib/isometric/utils/constants`.
export {
  ISOMETRIC_PROVIDER,
  REMOVAL_SUBMISSION_TYPE,
  REMOVAL_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  GHG_STATEMENT_ENTITY_TYPE,
} from "@/lib/isometric/utils/constants";

// Per-user abuse cap shared by the three registry submit actions
// (removal / GHG statement / telemetry). Generous enough that no legitimate
// operator hits it — ADR 0006 idempotency already makes a fast double-submit
// a no-op, so this only blunts runaway/scripted bursts. `key` is passed
// per-action so each pipeline is limited independently.
const SUBMIT_RATE_LIMIT_MAX = 5;
const SUBMIT_RATE_LIMIT_WINDOW_MS = 60_000;

export function submitRateLimit(key: string): {
  key: string;
  max: number;
  windowMs: number;
} {
  return {
    key,
    max: SUBMIT_RATE_LIMIT_MAX,
    windowMs: SUBMIT_RATE_LIMIT_WINDOW_MS,
  };
}

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
