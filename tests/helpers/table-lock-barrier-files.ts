// Table-level locks block writers across every organization in the shared test DB
// (#1379). Run these files after all other suites, one file at a time.
export const TABLE_LOCK_BARRIER_FILES = [
  "tests/derived-transport-leg-concurrency.test.ts",
  "tests/bin-reconciliation-integrity.test.ts",
];
