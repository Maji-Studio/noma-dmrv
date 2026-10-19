import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import type { OrgContext } from "@/lib/auth/server";
import { env } from "@/config/env";
import {
  appendSyncEvent,
  type AppendSyncEventInput,
} from "@/data-access/certification";
import { getTransportLegsWithEvidenceForEntities } from "@/data-access/transport-legs";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import { sanitizeErrorMessage } from "@/lib/log/sanitize";
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

// Per-user abuse cap for GHG Statement create/submit, Storage Location ensure,
// and Removal deletion. Blunts runaway/scripted bursts; each action supplies
// its own `key` so the limits are independent.
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

// Canonical best-effort sync-event recorder for cert/* submit pipelines.
// Consolidates the helpers that previously lived in
// submit-removal.ts and sources.ts. A failed audit-trail
// insert must NEVER unwind a successful submission, so this swallows the
// error and console.warns with caller-supplied context (e.g. submissionId).
export async function appendSyncEventBestEffort(
  orgCtx: OrgContext,
  input: AppendSyncEventInput,
  logContext?: Record<string, unknown>,
): Promise<void> {
  try {
    await appendSyncEvent(orgCtx, input);
  } catch (err) {
    logger.warn(
      {
        op: input.operation,
        entityId: input.entityId,
        ...logContext,
        // Drizzle errors embed bound params in the message; never log raw.
        err: sanitizeErrorMessage(err),
      },
      "failed to record certifier sync event",
    );
  }
}

export async function loadTransportLegsByCategory(
  orgCtx: OrgContext,
  entityIds: TransportEntityIdsByCategory,
  lineages: ChainOfCustodyData[],
  requiredTransportCategories: readonly (keyof TransportLegsByCategory)[],
): Promise<TransportLegsByCategory> {
  const [feedstock, biochar, sample] = await Promise.all([
    getTransportLegsWithEvidenceForEntities(orgCtx, "feedstock", entityIds.feedstockIds),
    // Accounting projects one frozen application × product × source-run slice
    // per lineage; never recompute its share from mutable product totals.
    requiredTransportCategories.includes("biochar")
      ? loadBiocharDeliveryTransportLegs(orgCtx, lineages.map(lineage => ({
          deliveryId: lineage.delivery.id,
          loadMassKg: tonnesToKg(lineage.application.biocharAppliedTons ?? 0),
        })))
      : [],
    getTransportLegsWithEvidenceForEntities(orgCtx, "sample", entityIds.sampleIds),
  ]);
  return { feedstock, biochar, sample };
}
