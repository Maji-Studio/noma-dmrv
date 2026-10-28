/**
 * The day to ask for a late run's emissions entry. A run can start before the
 * batch's first day while its membership date falls inside the batch, and the
 * entry form refuses dates outside the batch period, so clamp to the batch start.
 * Dates are facility-local YYYY-MM-DD, which compare correctly as strings.
 */
export function lateRunEntryDate(runStartDate: string, batchStartDate: string): string {
  return runStartDate < batchStartDate ? batchStartDate : runStartDate;
}
