/** Return originals remain active until an exact reversal references them. */
export const RETURN_MOVEMENT_TYPES = ['failed_run_return', 'failed_run_return_reversal'] as const;

interface ReturnHistoryRow {
  id: string;
  movementType: string;
  correctsMovementId: string | null;
}

export function activeReturns<T extends ReturnHistoryRow>(rows: readonly T[]): T[] {
  const reversed = new Set(rows.filter(row => row.movementType === RETURN_MOVEMENT_TYPES[1]).map(row => row.correctsMovementId));
  return rows.filter(row => row.movementType === RETURN_MOVEMENT_TYPES[0] && !reversed.has(row.id));
}
