import { SafeError } from "@/lib/errors";

export const CHANGED_SINCE_REVIEW_LABEL = "Changed since review";
export const CHANGED_FACT = "Part of it may already be in Isometric.";
export const ASK_ADMIN_TO_DELETE = "Ask an Admin to delete it. Then create the Removal again.";
export const OPEN_REMOVAL_TO_DELETE = "Open the Removal and select Delete Removal. Then create the Removal again.";
export const REMOVAL_BEING_DELETED = "This Removal is being deleted. Reload the page to see the result.";
export const FINALIZED_NO_DELETE = "This Removal is finalized, so it cannot be deleted. Contact an Admin.";

// A retry of a Removal that may already be in Isometric cannot be rebuilt from
// changed data: its registry references would send twice. Delete Removal
// removes what reached Isometric (including unconfirmed sends), then the
// operator creates the Removal again from current data (#1114). The submit
// dialog and the Removal sheet word the next step from what the viewer can do;
// this message is the server's default for API callers.
export const INTERRUPTED_REMOVAL_CHANGED_MESSAGE =
  "This Removal stopped, and part of it may already be in Isometric. Its data or settings changed since you reviewed it. Select Delete Removal to remove anything that reached Isometric. Then create the Removal again.";

/**
 * A possibly sent draft whose recheck failed for another reason (a template read, a missing
 * credential, a transient error). Nothing proves a change and nothing was sent, so it stays retryable.
 */
export const INTERRUPTED_REMOVAL_RECHECK_FAILED_MESSAGE =
  "noma could not check this Removal against current data, so nothing more was sent.";

/** The attempt summary's `failure_kind` for this refusal; the Removal sheet reads it back. */
export const CHANGED_SINCE_REVIEW_FAILURE_KIND = "changed_since_review";

export class InterruptedRemovalChangedError extends SafeError {
  constructor() {
    super(INTERRUPTED_REMOVAL_CHANGED_MESSAGE);
    this.name = "InterruptedRemovalChangedError";
  }
}
