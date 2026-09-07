"use server";

import { env } from "@/config/env";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import {
  getCertifierGhgStatementById,
} from "@/data-access/certifier-ghg-statements";
import {
  hasExactGhgEntryMembership,
} from "@/lib/certification/ghg-statement-breakdown";
import type { RegistryCarbonResult } from "@/lib/certification/registry-carbon-result";
import type { RegistryObservation } from "@/lib/certification/registry-observation";
import { SafeError } from "@/lib/errors";
import {
  getGhgEntry,
  getGhgStatement,
  getIsometricClientForOrg,
} from "@/lib/isometric";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
} from "@/lib/isometric/utils/constants";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

// The exact registry roll-up plus the identity bits the card chrome needs
// (the statement's registry id, the
// reporting window, the member count, the environment for the registry link).
export interface GhgStatementBreakdownData extends RegistryCarbonResult {
  ghgStatementId: string;
  externalId: string | null;
  reportingPeriodStartOn: string | null;
  reportingPeriodEndOn: string;
  memberGhgEntryCount: number;
  isProduction: boolean;
}

/**
 * Read-only exact registry roll-up. A carbon total is exposed only when every
 * registry member has a readable GHG Entry and those returned identities match
 * the statement membership. Local history is independent; there is no partial fallback.
 */
export async function loadGhgStatementBreakdown(
  ghgStatementId: string,
): Promise<ActionResult<RegistryObservation<GhgStatementBreakdownData>>> {
  return withAction(async (orgCtx) => {
    const statement = await getCertifierGhgStatementById(
      orgCtx,
      ghgStatementId,
    );
    if (!statement) throw new SafeError("GHG Statement not found.");

    const statementSubmission = await getLatestSubmission(orgCtx, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
      localEntityType: GHG_STATEMENT_ENTITY_TYPE,
      localEntityId: ghgStatementId,
    });
    const externalId = statementSubmission?.externalId ?? null;
    if (!externalId) {
      return { status: "pending", value: null, message: "Registry totals appear after the GHG Statement is created." };
    }

    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    let fetchedEntries: Array<Awaited<ReturnType<typeof getGhgEntry>>>;
    let remote: Awaited<ReturnType<typeof getGhgStatement>>;
    try {
      remote = await getGhgStatement(client, externalId);
      fetchedEntries = await Promise.all((remote?.ghg_entry_ids ?? []).map((id) => getGhgEntry(client, id)));
    } catch {
      return {
        status: "unavailable",
        value: null,
        message: "The registry roll-up could not be loaded. Try again.",
      };
    }
    const presentEntries = fetchedEntries.filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );
    if (presentEntries.some((entry) => entry.credit_type !== "REMOVAL")) {
      return { status: "unavailable", value: null, message: "This GHG Statement contains unsupported credit types. Registry removal totals require only removal entries." };
    }
    const allEntriesPresent =
      remote !== null &&
      hasExactGhgEntryMembership(
        presentEntries.map((entry) => entry.id),
        remote.ghg_entry_ids,
      );
    if (
      !allEntriesPresent ||
      presentEntries.some(
        (entry) =>
          !Number.isFinite(entry.co2e_net_removed_kg) ||
          !Number.isFinite(entry.co2e_net_removed_without_discount_kg),
      )
    ) {
      return {
        status: "pending",
        value: null,
        message:
          "Registry totals appear after Isometric finishes calculating the linked GHG Entries.",
      };
    }
    return {
      status: "available",
      value: {
        // Exact-member registry roll-up: linear sums of Isometric's entry
        // results. No local batch estimate, partial sum, uncertainty
        // propagation, or reconciliation is produced here.
        netRemovedKg: presentEntries.reduce(
          (sum, entry) => sum + entry.co2e_net_removed_kg,
          0,
        ),
        netBeforeDiscountKg: presentEntries.reduce(
          (sum, entry) =>
            sum + entry.co2e_net_removed_without_discount_kg,
          0,
        ),
        standardDeviationKg: null,
        riskOfReversalPercent: null,
        bufferCreditsKg:
          remote.credit_allocation?.buffer_pool_contribution_kg ?? null,
        supplierCreditsKg:
          remote.credit_allocation?.supplier_allocation_kg ?? null,
        registryStatementId: externalId,
        registryStatementStatus: remote.status ?? null,
        ghgStatementId,
        externalId,
        reportingPeriodStartOn: statement.reportingPeriodStartOn ?? null,
        reportingPeriodEndOn: statement.reportingPeriodEndOn,
        memberGhgEntryCount: remote.ghg_entry_ids.length,
        isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
      },
      message: "Exact registry roll-up available.",
    };
  });
}
