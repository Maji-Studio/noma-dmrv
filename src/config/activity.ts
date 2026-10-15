/**
 * Activity history (docs/database.md "Activity events").
 *
 * Every credit batch member records activity from this moment on: PR #1065
 * (application, batch, document and leg activity) merged then. Earlier changes
 * were never recorded, so empty and partial histories name this date.
 */
export const ACTIVITY_RECORDING_STARTED_AT = new Date("2026-10-15T20:02:55Z");

/** Entries the credit batch side sheet previews before linking to the full list. */
export const ACTIVITY_SHEET_PREVIEW_LIMIT = 5;
/** Page size of the Traceability Activity list; each "Show more" loads one page. */
export const ACTIVITY_LIST_PAGE_SIZE = 25;
