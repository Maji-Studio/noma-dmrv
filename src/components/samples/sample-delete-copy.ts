/**
 * Delete confirmation for a lab Sample. The only refusal is the Sent record
 * lock (`assertLockedLineagesAllowMutation` in the shared write scope); a
 * Sample linked to a credit batch deletes normally, taking its transport legs
 * and documents with it (`deleteSampleInTransaction`).
 */
export const SAMPLE_DELETE_MESSAGE =
  "Delete this Sample? Its transport legs and documents, including the lab report, are deleted with it. A Sample cannot be deleted once its Removal is Sent. This action cannot be undone.";
