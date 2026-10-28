import { env } from "@/config/env";
import { requireOrgFacility } from "@/data-access/utils";
import { hasFinalizedSubmission } from "@/data-access/certification-submissions";
import {
  getLatestSubmissionsForEntities,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import {
  getCreditBatchesByRemovalId,
  listRemovalsForFacility,
  listUngroupedCreditBatches,
  type CertifierRemovalRow,
  type UngroupedCreditBatchRow,
} from "@/data-access/certifier-removals";
import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";
import { removalMayHaveExternalMutation } from "@/lib/certification/removal-external-mutation";
import { submittedOnState, type SubmittedOnState } from "@/lib/certification/submitted-on";
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
  /** Date of the latest submission, even when a newer draft version exists. */
  submittedOn: SubmittedOnState;
  hasFinalizedSubmission: boolean;
  registryBoundaryOpened: boolean;
  /** A fresh Removal deletion lease hides Delete for every viewer. */
  deletionInProgress: boolean;
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
    const submissionKey = {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: REMOVAL_ENTITY_TYPE,
      localEntityIds: removalRows.map((removal) => removal.id),
    };
    const [submissions, submittedRows] = await Promise.all([
      getLatestSubmissionsForEntities(orgCtx, submissionKey, facilityId),
      getLatestSubmissionsForEntities(orgCtx, submissionKey, facilityId, undefined, {
        submitted: "ledger",
      }),
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
          const [batches, finalized] = await Promise.all([
            getCreditBatchesByRemovalId(orgCtx, removal.id),
            hasFinalizedSubmission(orgCtx, key),
          ]);
          return {
            removal,
            memberBatches: batches.map((b) => ({ id: b.id, code: b.code })),
            latestSubmission: submissions.get(removal.id) ?? null,
            submittedOn: submittedOnState(submittedRows.get(removal.id) ?? null),
            hasFinalizedSubmission: finalized,
            deletionInProgress: hasFreshRemovalDeletionLease(removal.metadata),
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
