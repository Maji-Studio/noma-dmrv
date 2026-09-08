import type { RemovalHubEntry } from "@/fn/certification/certify-context";
import type { RemovalPreflightSummary } from "@/fn/certification/overview";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { isRemovalSubmissionInterruptedFromSubmission } from "@/lib/certification/from-submission";

export type RemovalEnrichmentStatus =
  | "loading"
  | "available"
  | "unavailable";

export interface RemovalEnrichmentState {
  status: RemovalEnrichmentStatus;
  data: RemovalPreflightSummary | null;
  retry?: () => unknown;
}

export interface RemovalListRow {
  removalId: string;
  startedOn: string | null;
  completedOn: string | null;
  memberBatchCodes: string[];
  externalId: string | null;
  version: number | null;
  local: RemovalPreflightSummary["local"];
  lockInFlight: boolean;
  submissionInterrupted: boolean;
  readiness: RemovalPreflightSummary["readiness"] | null;
  evidenceHealth: RemovalPreflightSummary["evidenceHealth"];
  submissionWarnings: string[];
  recentSyncEvents: RemovalPreflightSummary["recentSyncEvents"];
  enrichmentStatus: RemovalEnrichmentStatus;
  retry?: () => unknown;
}

export function buildRemovalListRows(
  identities: RemovalHubEntry[],
  enrichmentByRemovalId: Record<string, RemovalEnrichmentState>,
): RemovalListRow[] {
  return identities.map((identity) => {
    const removalId = identity.removal.id;
    const enrichment = enrichmentByRemovalId[removalId] ?? {
      status: "loading" as const,
      data: null,
    };
    const data = enrichment.data;
    const lifecycleData = enrichment.status === "available" ? data : null;
    const startedOn = data?.startedOn ?? identity.removal.startedOn;
    const completedOn = data?.completedOn ?? identity.removal.completedOn;
    const local =
      lifecycleData?.local ?? identity.latestSubmission?.status ?? null;
    return {
      removalId,
      startedOn,
      completedOn,
      memberBatchCodes:
        data?.memberBatchCodes ??
        identity.memberBatches.map((batch) => batch.code),
      externalId:
        data?.externalId ?? identity.latestSubmission?.externalId ?? null,
      version: data?.version ?? identity.latestSubmission?.version ?? null,
      local,
      lockInFlight:
        lifecycleData?.lockInFlight ??
        (identity.latestSubmission
          ? isLockedInFlight(identity.latestSubmission)
          : false),
      submissionInterrupted:
        lifecycleData?.submissionInterrupted ??
        isRemovalSubmissionInterruptedFromSubmission(
          identity.latestSubmission,
          { startedOn, completedOn },
        ),
      readiness: lifecycleData?.readiness ?? null,
      evidenceHealth: data?.evidenceHealth ?? null,
      submissionWarnings: data?.submissionWarnings ?? [],
      recentSyncEvents: data?.recentSyncEvents ?? [],
      enrichmentStatus: enrichment.status,
      retry: enrichment.retry,
    };
  });
}

/**
 * A Removal may be deleted until a submission finalizes. `null` means no
 * ledger row; `draft` and `rejected` never reached "Submission complete". An
 * attempt still holding its lock is left alone unless it is known to be
 * interrupted. The server re-checks every rule under its own locks.
 */
export function canDeleteRemovalRow(
  row: Pick<RemovalListRow, "local" | "lockInFlight" | "submissionInterrupted">,
): boolean {
  const neverFinalized =
    row.local === null || row.local === "draft" || row.local === "rejected";
  const attemptRunning = row.lockInFlight && !row.submissionInterrupted;
  return neverFinalized && !attemptRunning;
}
