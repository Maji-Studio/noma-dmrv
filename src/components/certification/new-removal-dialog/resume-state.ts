import type { RemovalReadinessState } from "@/lib/certification/readiness";

/**
 * Only a live submission lock prevents reopening the submit step. A submitted
 * Removal may be reopened: the server-side claim policy returns the existing
 * version when its immutable payload is unchanged and creates a superseding
 * version when reviewed evidence or mappings changed.
 */
export function blocksRemovalResume(state: RemovalReadinessState): boolean {
  return state === "inProgress";
}

/** Submitted Removals use the same compiled, reviewed submit gate as drafts. */
export function allowsRemovalSubmission(
  state: RemovalReadinessState,
): boolean {
  return state === "ready" || state === "submitted";
}
