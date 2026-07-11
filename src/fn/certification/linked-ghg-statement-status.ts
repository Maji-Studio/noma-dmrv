import type { OrgContext } from "@/lib/auth/server";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import type { CertifierRemovalRow } from "@/data-access/certifier-removals";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import type { DerivedStatus } from "@/lib/certification/status";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
} from "./shared";

// The GHG Statement this removal has been rolled into (if any), with its
// derived verifier status. Carried separately from the removal's own
// `latestSubmission` so the bridge can show the statement's status without
// ever attributing a verifier lifecycle to the removal itself.
export interface LinkedGhgStatementStatus {
  id: string;
  status: DerivedStatus;
}

export async function loadLinkedGhgStatementStatus(
  orgCtx: OrgContext,
  removal: CertifierRemovalRow | null,
): Promise<LinkedGhgStatementStatus | null> {
  const ghgStatementId = removal?.ghgStatementId ?? null;
  if (!ghgStatementId) return null;

  const latest = await getLatestSubmission(orgCtx, {
    provider: ISOMETRIC_PROVIDER,
    submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
    localEntityType: GHG_STATEMENT_ENTITY_TYPE,
    localEntityId: ghgStatementId,
  });
  return {
    id: ghgStatementId,
    status: deriveSubmissionStatus(
      latest,
      latest ? isLockedInFlight(latest) : false,
      "ghgStatement",
    ),
  };
}
