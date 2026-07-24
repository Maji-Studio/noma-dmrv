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
import {
  resolveConservativeSoilTemperature,
  type ConservativeSoilTemperature,
} from "@/lib/isometric/utils/durability-aggregation";
import { SafeError } from "@/lib/errors";
import {
  getGhgEntry,
  getGhgStatement,
  getIsometricClientForOrg,
} from "@/lib/isometric";
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
  /**
   * Conservative soil-temperature estimate for the 200-year durability input —
   * the MAX across the removal's application sites (7 °C floor), surfaced as an
   * explicit conservative approximation (NOT a measured project-area annual
   * average; decision D2 soil-temp resolution). Null when no site carries a
   * soil temperature. The submitted value (Phase E) uses the same estimate;
   * the card shows it so the operator knows what drives the durable fraction.
   */
  soilTemperature: ConservativeSoilTemperature | null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Carbon-accounting breakdown for a single removal, on demand for the removal
 * detail sheet. Cheap by construction: it sums the per-batch certify previews
 * (`getCo2eStoredPreviews`, no chain-of-custody walk) for Sequestrations;
 * emissions/counterfactual are registry-owned (ADR 0018) so the local
 * estimate leaves them "not recorded".
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
  return withAction(async (orgCtx) => {
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    const removal = await getCertifierRemovalById(orgCtx, removalId);
    if (!removal) throw new SafeError("Removal not found.");

    const batches = await getCreditBatchesByRemovalId(orgCtx, removalId);
    const batchIds = batches.map((batch) => batch.id);

    const [previews, submission] = await Promise.all([
      getCo2eStoredPreviews(orgCtx, batchIds),
      getLatestSubmission(orgCtx, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: REMOVAL_SUBMISSION_TYPE,
        localEntityType: REMOVAL_ENTITY_TYPE,
        localEntityId: removalId,
      }),
    ]);

    const externalId = submission?.externalId ?? null;
    const ghgEntry = externalId
      ? await getGhgEntry(client, externalId).catch(() => null)
      : null;
    const ghgStatement =
      ghgEntry?.ghg_statement_id != null
        ? await getGhgStatement(client, ghgEntry.ghg_statement_id).catch(
            () => null,
          )
        : null;

    // Conservative soil-temperature estimate across the removal's application
    // sites (each preview's per-site value is already 7 °C-floored). Only build
    // it when at least one site carries a temperature, so removals without
    // durability soil-temp data don't show a spurious "indeterminate" note.
    // Restricted to 200-year batches: soil temperature drives only the 200-year
    // durable fraction — 1000-year (R₀/TGA) batches have no temperature term, so
    // surfacing a soil-temp note for them would misdescribe what credits them.
    const siteSoilTemperaturesC = batches
      .filter((batch) => batch.durabilityOption === "200_year")
      .flatMap((batch) =>
        (previews[batch.id]?.applicationResults ?? []).map(
          (app) => app.effectiveSoilTemperatureC,
        ),
      );
    const soilTemperature = siteSoilTemperaturesC.some(
      (t) => t != null && Number.isFinite(t),
    )
      ? resolveConservativeSoilTemperature(siteSoilTemperaturesC)
      : null;

    const breakdown = computeRemovalBreakdown({
      sequestrationTonnesByBatch: batches.map(
        (batch) => previews[batch.id]?.co2eStoredTonnes ?? null,
      ),
      // Project emissions and counterfactual are registry-owned (ADR 0018) —
      // there is no local copy (issue #285). All-null renders "not recorded";
      // the registry read below supplies the authoritative net when submitted.
      emissionsTonnesByBatch: batches.map(() => null),
      counterfactualTonnesByBatch: batches.map(() => null),
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
            ghgStatementId: ghgEntry.ghg_statement_id,
            ghgStatementStatus: ghgStatement?.status ?? null,
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
      soilTemperature,
    };
  });
}
