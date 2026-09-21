import { env } from "@/config/env";
import { requireOrgFacility } from "@/data-access/utils";
import {
  getLatestSubmission,
  hasFinalizedSubmission,
} from "@/data-access/certification-submissions";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import {
  getCreditBatchesByRemovalId,
  listRemovalsForFacility,
  listUngroupedCreditBatches,
  type CertifierRemovalRow,
  type UngroupedCreditBatchRow,
} from "@/data-access/certifier-removals";
import { removalMayHaveExternalMutation } from "@/lib/certification/removal-external-mutation";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import type { MemberCreditBatch } from "./member-credit-batch";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";

// Bounded fan-out for the per-Removal reads below; mirrors the context core.
const FANOUT_CONCURRENCY = 8;

export interface RemovalHubEntry {
  removal: CertifierRemovalRow;
  memberBatches: Pick<MemberCreditBatch, "id" | "code">[];
  latestSubmission: CertificationSubmissionRow | null;
  hasFinalizedSubmission: boolean;
  registryBoundaryOpened: boolean;
}

export interface RemovalsHubData {
  removals: RemovalHubEntry[];
  ungroupedBatches: UngroupedCreditBatchRow[];
  // Whether submits from the hub write to the production Isometric registry —
  // drives the confirmation gate on the hub's Submit button.
  isProduction: boolean;
}

// Removals hub payload for a facility: every Removal with its member credit
// batches and latest submission, plus newly applied mass not yet grouped.
export async function loadRemovalsForFacility(
  facilityId: string,
): Promise<ActionResult<RemovalsHubData>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const [removalRows, ungroupedBatches] = await Promise.all([
      listRemovalsForFacility(orgCtx, facilityId),
      listUngroupedCreditBatches(orgCtx, facilityId),
    ]);
    // Bounded chunks preserve order without bursting the connection pool.
    const removals: RemovalHubEntry[] = [];
    for (let i = 0; i < removalRows.length; i += FANOUT_CONCURRENCY) {
      const chunk = await Promise.all(
        removalRows.slice(i, i + FANOUT_CONCURRENCY).map(async (removal) => {
          const key = {
            provider: ISOMETRIC_PROVIDER,
            submissionType: REMOVAL_SUBMISSION_TYPE,
            localEntityType: REMOVAL_ENTITY_TYPE,
            localEntityId: removal.id,
          };
          const [batches, latestSubmission, finalized] = await Promise.all([
            getCreditBatchesByRemovalId(orgCtx, removal.id),
            getLatestSubmission(orgCtx, key),
            hasFinalizedSubmission(orgCtx, key),
          ]);
          return {
            removal,
            memberBatches: batches.map((b) => ({ id: b.id, code: b.code })),
            latestSubmission,
            hasFinalizedSubmission: finalized,
            registryBoundaryOpened: removalMayHaveExternalMutation(
              removal.metadata,
            ),
          };
        }),
      );
      removals.push(...chunk);
    }
    return {
      removals,
      ungroupedBatches,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}
