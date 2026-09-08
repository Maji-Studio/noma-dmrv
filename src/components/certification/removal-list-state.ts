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
  hasFinalizedSubmission: boolean;
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
      hasFinalizedSubmission:
        lifecycleData?.hasFinalizedSubmission ??
        identity.hasFinalizedSubmission,
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
 * Whether deleting this Removal may touch the registry: true as soon as a
 * ledger row exists, because a submission attempt may have created records
 * before it recorded their IDs. Drives the confirmation copy and the role
 * gate on both delete surfaces: a Removal with no ledger row can be released
 * by any member, anything with ledger history needs an Admin (mirrors
 * `claimRemovalDeletion`).
 */
export function removalDeletionTouchesRegistry(
  row: Pick<RemovalListRow, "local">,
): boolean {
  return row.local !== null;
}

type RemovalDeleteFacts = Pick<
  RemovalListRow,
  "local" | "lockInFlight" | "submissionInterrupted" | "hasFinalizedSubmission"
>;

/**
 * A Removal may be deleted until a submission finalizes. `null` means no
 * ledger row; `draft` and `rejected` never reached "Submission complete", but
 * an earlier version may have, which `hasFinalizedSubmission` carries. An
 * attempt still holding its lock is left alone unless it is known to be
 * interrupted. The server re-checks every rule under its own locks.
 */
export function canDeleteRemovalRow(row: RemovalDeleteFacts): boolean {
  const neverFinalized =
    !row.hasFinalizedSubmission &&
    (row.local === null || row.local === "draft" || row.local === "rejected");
  const attemptRunning = row.lockInFlight && !row.submissionInterrupted;
  return neverFinalized && !attemptRunning;
}

/**
 * The full client-side gate both delete surfaces use: eligible, and either
 * no registry exposure or a viewer who may manage the registry connection.
 * Mirrors the role floor in `claimRemovalDeletion`.
 */
export function canViewerDeleteRemoval(
  row: RemovalDeleteFacts,
  viewerCanManage: boolean,
): boolean {
  return (
    canDeleteRemovalRow(row) &&
    (!removalDeletionTouchesRegistry(row) || viewerCanManage)
  );
}
