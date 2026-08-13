"use server";

import { env } from "@/config/env";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import type { RegistryCarbonResult } from "@/lib/certification/registry-carbon-result";
import type { RegistryObservation } from "@/lib/certification/registry-observation";
import {
  readRemovalDurabilityComponent,
  type RemovalDurabilityComponentDisplay,
} from "@/lib/certification/removal-durability-component";
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

// The registry-result payload plus the identity bits the card chrome needs
// (the registry id it links to, the
// reporting window, the environment for the registry deep link).
export interface RemovalBreakdownData extends RegistryCarbonResult {
  removalId: string;
  externalId: string | null;
  startedOn: string | null;
  completedOn: string | null;
  isProduction: boolean;
  durabilityComponent: RemovalDurabilityComponentDisplay | null;
}

/**
 * Read-only observation of the registry's carbon result for one Removal.
 * Isometric is the sole calculation authority: this path never loads or
 * computes a local gross/net fallback.
 */
export async function loadRemovalBreakdown(
  removalId: string,
): Promise<ActionResult<RegistryObservation<RemovalBreakdownData>>> {
  return withAction(async (orgCtx) => {
    const removal = await getCertifierRemovalById(orgCtx, removalId);
    if (!removal) throw new SafeError("Removal not found.");

    const submission = await getLatestSubmission(orgCtx, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: REMOVAL_ENTITY_TYPE,
      localEntityId: removalId,
    });
    const externalId = submission?.externalId ?? null;
    if (!externalId) {
      return {
        status: "pending",
        value: null,
        message: "Submit this Removal to see its registry carbon result.",
      };
    }

    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    let ghgEntry: Awaited<ReturnType<typeof getGhgEntry>>;
    try {
      ghgEntry = await getGhgEntry(client, externalId);
    } catch {
      return {
        status: "unavailable",
        value: null,
        message:
          "The registry carbon result could not be loaded. Refresh the page and try again.",
      };
    }

    if (
      !Number.isFinite(ghgEntry.co2e_net_removed_kg) ||
      !Number.isFinite(ghgEntry.co2e_net_removed_without_discount_kg)
    ) {
      return {
        status: "pending",
        value: null,
        message: "Isometric is calculating the carbon result.",
      };
    }

    const ghgStatement =
      ghgEntry?.ghg_statement_id != null
        ? await getGhgStatement(client, ghgEntry.ghg_statement_id).catch(
            () => null,
          )
        : null;

    return {
      status: "available",
      value: {
        netRemovedKg: ghgEntry.co2e_net_removed_kg,
        netBeforeDiscountKg:
          ghgEntry.co2e_net_removed_without_discount_kg,
        standardDeviationKg:
          ghgEntry.co2e_net_removed_standard_deviation_kg,
        riskOfReversalPercent: ghgEntry.risk_of_reversal_percentage,
        bufferCreditsKg:
          ghgEntry.credit_allocation?.buffer_pool_contribution_kg ?? null,
        supplierCreditsKg:
          ghgEntry.credit_allocation?.supplier_allocation_kg ?? null,
        registryStatementId: ghgEntry.ghg_statement_id,
        registryStatementStatus: ghgStatement?.status ?? null,
        removalId,
        externalId,
        startedOn: removal.startedOn,
        completedOn: removal.completedOn,
        isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
        durabilityComponent: readRemovalDurabilityComponent(
          submission?.payloadSnapshot,
        ),
      },
      message: "Registry result available.",
    };
  });
}
