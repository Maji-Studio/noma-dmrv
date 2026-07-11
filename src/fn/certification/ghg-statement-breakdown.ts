"use server";

import { env } from "@/config/env";
import { getLatestSubmissionsForEntities } from "@/data-access/certification";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import {
  getCertifierGhgStatementById,
  getRemovalsByGhgStatementId,
} from "@/data-access/certifier-ghg-statements";
import { getCreditBatchesByRemovalId } from "@/data-access/certifier-removals";
import { getCo2eStoredPreviews } from "@/data-access/credit-batches";
import {
  computeGhgStatementBreakdown,
  type GhgStatementEntryFigures,
} from "@/lib/certification/ghg-statement-breakdown";
import type { RemovalCarbonBreakdown } from "@/lib/certification/removal-breakdown";
import { SafeError } from "@/lib/errors";
import { getGhgEntry, getGhgStatement } from "@/lib/isometric";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "@/lib/isometric/utils/constants";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

// The breakdown card payload: the reconciled carbon accounting plus the
// identity bits the card chrome needs (the statement's registry id, the
// reporting window, the member count, the environment for the registry link).
export interface GhgStatementBreakdownData extends RemovalCarbonBreakdown {
  ghgStatementId: string;
  externalId: string | null;
  reportingPeriodStartOn: string | null;
  reportingPeriodEndOn: string;
  memberRemovalCount: number;
  isProduction: boolean;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Carbon-accounting breakdown for a GHG statement, on demand for the statement
 * detail sheet. A statement is a period roll-up of its member removals, so the
 * breakdown is the sum across them:
 *
 *  - **Local estimate** (always available): the per-batch certify previews
 *    (`getCo2eStoredPreviews`, no chain-of-custody walk) for Sequestrations and
 *    the emissions/counterfactual columns, flattened across every member
 *    removal's credit batches — the same shape a single removal computes, just
 *    over the union of batches.
 *  - **Registry roll-up** (once members are submitted): each member removal's
 *    GHG entry read back for the authoritative per-entry net, summed; the
 *    buffer-pool split is read from the statement's `credit_allocation`.
 *
 * The registry reads are best-effort. The roll-up is used only when *every*
 * member removal's entry is readable — a partial sum would understate the
 * total, so a missing or unconfigured entry degrades the whole card to the
 * local estimate rather than showing a number that doesn't add up. None of the
 * registry reads can fail the sheet.
 */
export async function loadGhgStatementBreakdown(
  ghgStatementId: string,
): Promise<ActionResult<GhgStatementBreakdownData>> {
  return withAction(async (orgCtx) => {
    const statement = await getCertifierGhgStatementById(
      orgCtx,
      ghgStatementId,
    );
    if (!statement) throw new SafeError("GHG statement not found.");

    const removals = await getRemovalsByGhgStatementId(orgCtx, ghgStatementId);
    const removalIds = removals.map((removal) => removal.id);

    // Member credit batches across every removal, flattened — the local
    // estimate sums the union, identical to the single-removal case.
    const batchLists = await Promise.all(
      removalIds.map((id) => getCreditBatchesByRemovalId(orgCtx, id)),
    );
    const batches = batchLists.flat();
    const batchIds = batches.map((batch) => batch.id);

    const [previews, removalSubmissions, statementSubmission] =
      await Promise.all([
        getCo2eStoredPreviews(orgCtx, batchIds),
        getLatestSubmissionsForEntities(orgCtx, {
          provider: ISOMETRIC_PROVIDER,
          submissionType: REMOVAL_SUBMISSION_TYPE,
          localEntityType: REMOVAL_ENTITY_TYPE,
          localEntityIds: removalIds,
        }),
        getLatestSubmission(orgCtx, {
          provider: ISOMETRIC_PROVIDER,
          submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
          localEntityType: GHG_STATEMENT_ENTITY_TYPE,
          localEntityId: ghgStatementId,
        }),
      ]);

    // Each member removal's rmv_… external id is its GHG-entry id. Read them
    // back best-effort; only roll up the registry figures when we have an
    // entry for every member (else degrade to the local estimate).
    const entryExternalIds = removalIds
      .map((id) => removalSubmissions.get(id)?.externalId)
      .filter((value): value is string => Boolean(value));
    const fetchedEntries = await Promise.all(
      entryExternalIds.map((id) => getGhgEntry(id).catch(() => null)),
    );
    const presentEntries = fetchedEntries.filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );
    const allEntriesPresent =
      removalIds.length > 0 && presentEntries.length === removalIds.length;
    const entries: GhgStatementEntryFigures[] = allEntriesPresent
      ? presentEntries.map((entry) => ({
          netRemovedKg: entry.co2e_net_removed_kg,
          netBeforeDiscountKg: entry.co2e_net_removed_without_discount_kg,
          standardDeviationKg: entry.co2e_net_removed_standard_deviation_kg,
        }))
      : [];

    // The buffer/supplier split lives only on the statement (it's null until
    // every entry's risk-of-reversal is set), so read it from the remote
    // statement rather than summing per-entry allocations.
    const externalId = statementSubmission?.externalId ?? null;
    const remote = externalId
      ? await getGhgStatement(externalId).catch(() => null)
      : null;
    const creditAllocation = remote?.credit_allocation
      ? {
          bufferCreditsKg: remote.credit_allocation.buffer_pool_contribution_kg,
          supplierCreditsKg: remote.credit_allocation.supplier_allocation_kg,
        }
      : null;

    const breakdown = computeGhgStatementBreakdown({
      sequestrationTonnesByBatch: batches.map(
        (batch) => previews[batch.id]?.co2eStoredTonnes ?? null,
      ),
      // Project emissions and counterfactual are registry-owned (ADR 0018) —
      // there is no local copy (issue #285). All-null renders "not recorded";
      // the registry entries above supply the authoritative net when readable.
      emissionsTonnesByBatch: batches.map(() => null),
      counterfactualTonnesByBatch: batches.map(() => null),
      missingInputs: unique(
        batches.flatMap((batch) => previews[batch.id]?.missingInputs ?? []),
      ),
      memberBatchCount: batches.length,
      entries,
      creditAllocation,
    });

    return {
      ...breakdown,
      ghgStatementId,
      externalId,
      reportingPeriodStartOn: statement.reportingPeriodStartOn ?? null,
      reportingPeriodEndOn: statement.reportingPeriodEndOn,
      memberRemovalCount: removals.length,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}
