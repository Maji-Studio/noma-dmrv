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
  code: string;
  startedOn: string | null;
  completedOn: string | null;
  memberBatchCodes: string[];
  externalId: string | null;
  version: number | null;
  local: RemovalPreflightSummary["local"];
  lockInFlight: boolean;
  submissionInterrupted: boolean;
  hasFinalizedSubmission: boolean;
  registryBoundaryOpened: boolean;
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
      code: data?.code ?? identity.removal.code,
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
      registryBoundaryOpened:
        lifecycleData?.registryBoundaryOpened ??
        identity.registryBoundaryOpened,
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
 * What a delete surface knows beyond the Removal row: whether the viewer meets
 * the registry deletion role floor (server-computed from
 * `REMOVAL_REGISTRY_DELETION_MIN_ROLE`, issue #746) and whether a member credit
 * batch carries a Production Batch registration. `null` while either is still
 * loading or failed to load.
 */
export interface RemovalDeleteAccess {
  viewerCanDeleteRegistryRemovals: boolean | null;
  hasRegisteredProductionBatches: boolean | null;
}

/**
 * Whether deleting this Removal may touch the registry: true as soon as a
 * ledger row exists (a submission attempt may have created records before it
 * recorded their IDs), a submit attempt opened the registry boundary before
 * any ledger row, or a member credit batch is registered as a Production
 * Batch. Drives the confirmation copy and the role floor on both delete
 * surfaces, mirroring the server's boundary check in `claimRemovalDeletion`.
 */
export function removalDeletionTouchesRegistry(
  row: Pick<RemovalListRow, "local" | "registryBoundaryOpened">,
  access?: Pick<RemovalDeleteAccess, "hasRegisteredProductionBatches">,
): boolean {
  return (
    row.local !== null ||
    row.registryBoundaryOpened ||
    access?.hasRegisteredProductionBatches === true
  );
}

type RemovalDeleteFacts = Pick<
  RemovalListRow,
  | "local"
  | "lockInFlight"
  | "submissionInterrupted"
  | "hasFinalizedSubmission"
  | "registryBoundaryOpened"
>;

/**
 * A Removal may be deleted until a submission finalizes. `null` means no
 * ledger row; `draft` and `rejected` never reached "Submission complete", but
 * an earlier version may have, which `hasFinalizedSubmission` carries. An
 * attempt still holding its lock is left alone unless it is known to be
 * interrupted. Members may delete only a Removal that never touched the
 * registry; once it did, the viewer must meet the role floor. Unknown access
 * hides the action rather than offering one the server would refuse. The
 * server re-checks every rule under its own locks.
 */
export function canDeleteRemovalRow(
  row: RemovalDeleteFacts,
  access: RemovalDeleteAccess,
): boolean {
  const neverFinalized =
    !row.hasFinalizedSubmission &&
    (row.local === null || row.local === "draft" || row.local === "rejected");
  const attemptRunning = row.lockInFlight && !row.submissionInterrupted;
  if (!neverFinalized || attemptRunning) return false;
  if (access.viewerCanDeleteRegistryRemovals === true) return true;
  const boundaryKnownClosed =
    access.hasRegisteredProductionBatches === false &&
    !removalDeletionTouchesRegistry(row, access);
  return boundaryKnownClosed;
}
