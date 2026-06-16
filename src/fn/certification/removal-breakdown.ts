"use server";

import { env } from "@/config/env";
import { getCo2eStoredPreviews } from "@/data-access/credit-batches";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import {
  getCertifierRemovalById,
  getCreditBatchesByRemovalId,
} from "@/data-access/certifier-removals";
import {
  computeRemovalBreakdown,
  type RemovalCarbonBreakdown,
} from "@/lib/certification/removal-breakdown";
import { SafeError } from "@/lib/errors";
import { getGhgEntry } from "@/lib/isometric";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "@/lib/isometric/utils/constants";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

// The breakdown card payload: the reconciled carbon accounting plus the
// identity bits the card chrome needs (the registry id it links to, the
// reporting window, the environment for the registry deep link).
export interface RemovalBreakdownData extends RemovalCarbonBreakdown {
  removalId: string;
  externalId: string | null;
  startedOn: string | null;
  completedOn: string | null;
  isProduction: boolean;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Carbon-accounting breakdown for a single removal, on demand for the removal
 * detail sheet. Cheap by construction: it sums the per-batch certify previews
 * (`getCo2eStoredPreviews`, no chain-of-custody walk) for Sequestrations and
 * reads emissions/counterfactual straight off the member credit-batch rows.
 *
 * If the removal has been submitted it also reads the GHG entry back from the
 * registry for the authoritative net, the uncertainty discount and the
 * buffer-pool split. That read is best-effort — a registry hiccup or
 * unconfigured Isometric env degrades to the local estimate rather than
 * failing the sheet (`getGhgEntry(...).catch(() => null)`).
 */
export async function loadRemovalBreakdown(
  removalId: string,
): Promise<ActionResult<RemovalBreakdownData>> {
  return withAction(async (userId) => {
    const removal = await getCertifierRemovalById(userId, removalId);
    if (!removal) throw new SafeError("Removal not found.");

    const batches = await getCreditBatchesByRemovalId(userId, removalId);
    const batchIds = batches.map((batch) => batch.id);

    const [previews, submission] = await Promise.all([
      getCo2eStoredPreviews(userId, batchIds),
      getLatestSubmission(userId, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: REMOVAL_SUBMISSION_TYPE,
        localEntityType: REMOVAL_ENTITY_TYPE,
        localEntityId: removalId,
      }),
    ]);

    const externalId = submission?.externalId ?? null;
    const ghgEntry = externalId
      ? await getGhgEntry(externalId).catch(() => null)
      : null;

    const breakdown = computeRemovalBreakdown({
      sequestrationTonnesByBatch: batches.map(
        (batch) => previews[batch.id]?.co2eStoredTonnes ?? null,
      ),
      emissionsTonnesByBatch: batches.map(
        (batch) => batch.totalCo2eEmissionsTons,
      ),
      counterfactualTonnesByBatch: batches.map(
        (batch) => batch.totalCo2eCounterfactualTons,
      ),
      missingInputs: unique(
        batches.flatMap((batch) => previews[batch.id]?.missingInputs ?? []),
      ),
      memberBatchCount: batches.length,
      registry: ghgEntry
        ? {
            netRemovedKg: ghgEntry.co2e_net_removed_kg,
            netBeforeDiscountKg: ghgEntry.co2e_net_removed_without_discount_kg,
            standardDeviationKg: ghgEntry.co2e_net_removed_standard_deviation_kg,
            riskOfReversalPercent: ghgEntry.risk_of_reversal_percentage,
            bufferCreditsKg:
              ghgEntry.credit_allocation?.buffer_pool_contribution_kg ?? null,
            supplierCreditsKg:
              ghgEntry.credit_allocation?.supplier_allocation_kg ?? null,
          }
        : null,
    });

    return {
      ...breakdown,
      removalId,
      externalId,
      startedOn: removal.startedOn,
      completedOn: removal.completedOn,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}
