/** Return originals remain active until an exact reversal references them. */
export const RETURN_MOVEMENT_TYPE = 'failed_run_return';
export const RETURN_REVERSAL_MOVEMENT_TYPE = 'failed_run_return_reversal';
export const RETURN_MOVEMENT_TYPES = [RETURN_MOVEMENT_TYPE, RETURN_REVERSAL_MOVEMENT_TYPE] as const;

interface ReturnHistoryRow {
  id: string;
  movementType: string;
  correctsMovementId: string | null;
}

export function activeReturns<T extends ReturnHistoryRow>(rows: readonly T[]): T[] {
  const reversed = new Set(rows.filter(row => row.movementType === RETURN_REVERSAL_MOVEMENT_TYPE).map(row => row.correctsMovementId));
  return rows.filter(row => row.movementType === RETURN_MOVEMENT_TYPE && !reversed.has(row.id));
}
