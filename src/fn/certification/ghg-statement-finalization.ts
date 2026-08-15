import {
  markSubmissionSubmitted,
  updateSubmissionMetadata,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import { reconcileGhgStatementRemoteState } from "@/data-access/certifier-ghg-remote-state";
import type { CertifierGhgStatementRow } from "@/data-access/certifier-ghg-statements";
import { withFacilityDurabilityLock } from "@/data-access/facility-durability-lock";
import type { OrgContext } from "@/lib/auth/server";
import {
  getGhgStatement,
  type IsometricClient,
} from "@/lib/isometric";
import {
  expectedButExcludedWarnings,
  type ExpectedRemoval,
} from "@/lib/isometric/utils/ghg-entry-membership";
import { SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import type {
  CreateGhgStatementResult,
  GhgStatementCreateOutcome,
} from "./ghg-statements";

/**
 * Shared tail for fresh and reconciled creates. The external id, fallback
 * metadata, and authoritative remote-state writes share the facility lock and
 * one transaction; registry HTTP uses the lock's dedicated connection.
 */
export async function finalizeGhgStatement(args: {
  client: IsometricClient;
  orgCtx: OrgContext;
  statement: CertifierGhgStatementRow;
  row: CertificationSubmissionRow;
  externalId: string;
  expected: ExpectedRemoval[];
  outcome: GhgStatementCreateOutcome;
}): Promise<CreateGhgStatementResult> {
  const { client, orgCtx, statement, row, externalId, expected, outcome } =
    args;

  return withFacilityDurabilityLock(
    orgCtx,
    statement.facilityId,
    async (tx) => {
      // The identity was journaled on the still-locked draft by onConfirmed.
      // Commit the submitted transition only with the remaining local
      // reconciliation so a failure leaves a resumable interrupted draft.
      await markSubmissionSubmitted(
        orgCtx,
        row.id,
        { externalId, supersedePreviousId: null },
        tx,
      );
      const remote = await getGhgStatement(client, externalId).catch(
        () => null,
      );
      if (!remote) {
        await updateSubmissionMetadata(
          orgCtx,
          row.id,
          {
            [SUBMISSION_METADATA_KEYS.remoteStatus]: "DRAFT",
          },
          tx,
        );
        return {
          outcome,
          ghgStatementId: statement.id,
          externalId,
          linkedRemovalIds: [],
          warnings: [],
        };
      }

      const reconciled = await reconcileGhgStatementRemoteState(
        orgCtx,
        {
          statementId: statement.id,
          submission: row,
          remote,
        },
        tx,
      );
      return {
        outcome,
        ghgStatementId: statement.id,
        externalId,
        linkedRemovalIds: reconciled.linkedRemovalIds,
        warnings: [
          ...reconciled.warnings,
          ...expectedButExcludedWarnings(
            expected,
            reconciled.linkedRemovalIds,
          ),
        ],
      };
    },
  );
}
