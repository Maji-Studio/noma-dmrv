/**
 * Delete confirmation for a lab Sample. It names what the delete takes with
 * it (`deleteSampleInTransaction`: transport legs, then the Sample's
 * documents such as the lab report). Refusals are not listed here: the Sent
 * record lock (`assertLockedLineagesAllowMutation`, which a returned
 * statement can lift) and documents that certification history or reviewed
 * evidence still reference (`retireOwnedDocuments`) arrive as the server's own
 * message.
 */
export const SAMPLE_DELETE_MESSAGE =
  "Delete this Sample? This also deletes its transport legs and documents, such as the lab report. This action cannot be undone.";
