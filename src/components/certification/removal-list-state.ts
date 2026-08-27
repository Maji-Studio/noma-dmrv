import type { RemovalHubEntry } from "@/fn/certification/certify-context";
import type { RemovalPreflightSummary } from "@/fn/certification/overview";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { isRemovalSubmissionInterrupted } from "@/lib/certification/status";

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
        (isRemovalSubmissionInterrupted(identity.latestSubmission?.metadata) ||
          (local === "submitted" && (!startedOn || !completedOn))),
      readiness: lifecycleData?.readiness ?? null,
      evidenceHealth: data?.evidenceHealth ?? null,
      submissionWarnings: data?.submissionWarnings ?? [],
      recentSyncEvents: data?.recentSyncEvents ?? [],
      enrichmentStatus: enrichment.status,
      retry: enrichment.retry,
    };
  });
}
