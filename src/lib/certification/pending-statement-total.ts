/** Isometric uses null for no pending changes; a finite zero is a pending total. */
export function hasPendingStatementTotal(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
