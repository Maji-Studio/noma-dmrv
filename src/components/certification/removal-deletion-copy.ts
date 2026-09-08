/**
 * Copy for deleting a never-finalized Removal. Shared by the Removal detail
 * sheet and the New Removal wizard so the two surfaces cannot drift. Which
 * variant applies depends on whether the Removal has ledger history
 * (`removalDeletionTouchesRegistry`); each surface derives that from the
 * facts it already holds.
 */

export const REMOVAL_DELETE_TITLE = "Delete Removal?";
export const REMOVAL_DISCARD_TITLE = "Discard Removal draft?";

export const REMOVAL_DELETE_WITH_REGISTRY_MESSAGE =
  "This deletes any draft GHG Entry and Biochar Applications this Removal created from Isometric, then releases the credit batches. Registry records that are no longer drafts cannot be deleted. This action cannot be undone.";
export const REMOVAL_DELETE_LOCAL_ONLY_MESSAGE =
  "This releases its credit batches so you can group them into separate Removals. This action cannot be undone.";

export const REMOVAL_DELETED_TOAST =
  "Removal deleted. Credit batches are available again.";
export const REMOVAL_DISCARDED_TOAST =
  "Removal draft discarded. Credit batches are available again.";

export function removalDeleteMessage(hasRegistryHistory: boolean): string {
  return hasRegistryHistory
    ? REMOVAL_DELETE_WITH_REGISTRY_MESSAGE
    : REMOVAL_DELETE_LOCAL_ONLY_MESSAGE;
}
