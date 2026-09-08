/**
 * Copy for deleting a never-finalized Removal. Shared by the Removal detail
 * sheet and the New Removal wizard so the two surfaces cannot drift. Which
 * variant applies depends on whether the Removal may have touched the
 * registry (`removalDeletionTouchesRegistry`); each surface derives that from
 * the facts it already holds and takes the whole variant from
 * `removalDeletionCopy`.
 */

export const REMOVAL_DELETE_TITLE = "Delete Removal?";
export const REMOVAL_DISCARD_TITLE = "Discard Removal draft?";

export const REMOVAL_DELETE_WITH_REGISTRY_MESSAGE =
  "This deletes from Isometric any draft GHG Entry and Biochar Applications this Removal created, then releases the credit batches. Registry records that are no longer drafts cannot be deleted. This action cannot be undone.";
export const REMOVAL_DELETE_LOCAL_ONLY_MESSAGE =
  "This releases its credit batches so you can group them into separate Removals. This action cannot be undone.";

export const REMOVAL_DELETED_TOAST =
  "Removal deleted. Credit batches are available again.";
export const REMOVAL_DISCARDED_TOAST =
  "Removal draft discarded. Credit batches are available again.";

export interface RemovalDeletionCopy {
  /** Trigger button and confirm button label. */
  actionLabel: string;
  title: string;
  message: string;
  pendingLabel: string;
  successToast: string;
}

export function removalDeletionCopy(
  hasRegistryHistory: boolean,
): RemovalDeletionCopy {
  return hasRegistryHistory
    ? {
        actionLabel: "Delete Removal",
        title: REMOVAL_DELETE_TITLE,
        message: REMOVAL_DELETE_WITH_REGISTRY_MESSAGE,
        pendingLabel: "Deleting...",
        successToast: REMOVAL_DELETED_TOAST,
      }
    : {
        actionLabel: "Discard draft",
        title: REMOVAL_DISCARD_TITLE,
        message: REMOVAL_DELETE_LOCAL_ONLY_MESSAGE,
        pendingLabel: "Discarding...",
        successToast: REMOVAL_DISCARDED_TOAST,
      };
}
