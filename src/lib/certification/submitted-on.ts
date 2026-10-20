import { REGISTRY_DISCOVERY_SOURCE } from "./submission-source";

export type SubmittedOnState =
  | { kind: "submitted"; at: Date | string }
  | { kind: "registryDiscovered" }
  | { kind: "never" };

export function submittedOnState(
  submission: {
    submittedAt: Date | string | null;
    payloadSnapshot: unknown;
  } | null,
): SubmittedOnState {
  if (submission === null || submission.submittedAt === null) {
    return { kind: "never" };
  }

  const snapshot = submission.payloadSnapshot;
  if (
    typeof snapshot === "object" &&
    snapshot !== null &&
    "semantic" in snapshot
  ) {
    const semantic = snapshot.semantic;
    if (
      typeof semantic === "object" &&
      semantic !== null &&
      "source" in semantic &&
      semantic.source === REGISTRY_DISCOVERY_SOURCE
    ) {
      return { kind: "registryDiscovered" };
    }
  }

  return { kind: "submitted", at: submission.submittedAt };
}

/** Shown for a Removal or GHG Statement that has no submission yet. */
export const NOT_SUBMITTED_LABEL = "Not submitted";
