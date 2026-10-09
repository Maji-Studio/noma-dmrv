import { conflictCode } from '@/lib/conflict-ref';
import { DomainError } from '@/lib/domain-errors';
import { ActionConflictError, SafeError } from '@/lib/errors';
import type { OutputStockBlocking, OutputStockShortage } from '@/lib/output-stock';
import { STOCK_CONFLICT_ENTITY } from '@/lib/stock-conflict-entities';

export const STOCK_CHANGED_MESSAGE = 'Stock changed since this preview. Refresh the preview and try again.';

/**
 * The stock a preview was computed from moved before the write. Still an
 * `ActionConflictError` (same name, message and bin `conflict`), so forms keep
 * their refresh prompt; typed callers map it to `stock_basis_changed`.
 */
export class StockBasisChangedError extends ActionConflictError {
  constructor(bin: { id: string; code: string }) {
    super(STOCK_CHANGED_MESSAGE, { entity: STOCK_CONFLICT_ENTITY.storageLocation, id: bin.id, code: conflictCode(bin.code) });
  }
}

/** A capacity refusal from the output-stock planner; the message is the operator's blocking message. */
export class OutputStockShortageError extends SafeError {
  constructor(message: string, readonly details: OutputStockShortage) {
    super(message);
    this.name = 'OutputStockShortageError';
  }
}

/** What a blocked plan throws: a typed shortage for a capacity failure, otherwise the plain refusal. */
export function blockedOutputStockError(blocking: OutputStockBlocking | null | undefined, message: string): SafeError {
  if (blocking?.kind !== 'insufficient_stock') return new SafeError(message);
  const { storageLocationId, layerId, availableSolidsKg, requestedSolidsKg } = blocking;
  return new OutputStockShortageError(message, { storageLocationId, ...(layerId ? { layerId } : {}), availableSolidsKg, requestedSolidsKg });
}

/** A missing or foreign output-stock reference, pointing at the field that named it. */
export function outputReferenceNotFound(message: string, path: (string | number)[]): DomainError {
  return new DomainError('not_found', message, { issues: [{ path, code: 'not_found', message }] });
}
