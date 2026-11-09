import { SafeError } from "@/lib/errors";

// A retry of a Removal that may already be in Isometric cannot be rebuilt from
// changed data: its registry references would send twice. Delete Removal
// removes what reached Isometric (including unconfirmed sends), then the
// operator creates the Removal again from current data (#1114). The submit
// dialog and the Removal sheet word the next step from what the viewer can do;
// this message is the server's default for API callers.
export const INTERRUPTED_REMOVAL_CHANGED_MESSAGE =
  "This Removal stopped, and part of it may already be in Isometric. Its data or settings changed since you reviewed it. Select Delete Removal to remove anything that reached Isometric. Then create the Removal again.";

/** The attempt summary's `failure_kind` for this refusal; the Removal sheet reads it back. */
export const CHANGED_SINCE_REVIEW_FAILURE_KIND = "changed_since_review";

export class InterruptedRemovalChangedError extends SafeError {
  constructor() {
    super(INTERRUPTED_REMOVAL_CHANGED_MESSAGE);
    this.name = "InterruptedRemovalChangedError";
  }
}
