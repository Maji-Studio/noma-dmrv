export const DOCUMENT_UPLOAD_LEASE_MS = 5 * 60_000;
export const DOCUMENT_UPLOAD_MAX_LIFETIME_MS = 60 * 60_000;
export const DOCUMENT_UPLOAD_GRACE_MS = 10 * 60_000;
export const DOCUMENT_CONFIRM_DEADLINE_MS = 25_000;
export const DOCUMENT_CONFIRM_DB_RESERVE_MS = 5_000;
export const DOCUMENT_CONFIRM_RETRY_AFTER_SECONDS = 1;
export const DOCUMENT_STORAGE_DRAIN_BUDGET_MS = 1_000;
export const DOCUMENT_PROMOTION_CANDIDATE_LIMIT = 8;
const SECONDS_PER_MINUTE = 60;
export const DOCUMENT_DOWNLOAD_TTL_SECONDS = 5 * SECONDS_PER_MINUTE;
export const DOCUMENT_DOWNLOAD_TTL_MINUTES = DOCUMENT_DOWNLOAD_TTL_SECONDS / SECONDS_PER_MINUTE;

// Keep failed declarations for troubleshooting before removing their rows.
export const DOCUMENT_FAILED_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const DOCUMENT_SWEEP_BATCH_SIZE = 100;
// Leave 20 seconds for deletion and 10 seconds for route overhead.
export const DOCUMENT_SWEEP_BUDGET_MS = 30_000;
export const DOCUMENT_SWEEP_DRAIN_BUDGET_MS = 20_000;

export const UPLOAD_NOT_PENDING_MESSAGE = "This file is no longer waiting for confirmation. Upload it again.";
