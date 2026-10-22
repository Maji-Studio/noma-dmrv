import { massGrams } from './calculations/gram-allocation';
import { DomainError } from './domain-errors';
import { withRecordLockGuidance, type RecordLock } from './record-lock';

const RECORD_LOCK_CONTROL_FIELDS = new Set(['expectedVersion', 'idempotencyKey', 'correctsMovementId', 'basisFingerprint', 'sources']);

/** Mass inputs and database projections agree at the ledger's gram precision. */
export function recordFieldEqual(field: string, previous: unknown, next: unknown): boolean {
  if (field.endsWith('Kg') && typeof previous === 'number' && typeof next === 'number') return massGrams(previous) === massGrams(next);
  return JSON.stringify(previous) === JSON.stringify(next);
}

/** Shared comparison for dependency locks and lineage refusals. */
function changedRecordFields(previous: object, changes: object, freeFields: readonly string[] = []) {
  const before = new Map(Object.entries(previous));
  return Object.entries(changes).filter(([field, value]) => !RECORD_LOCK_CONTROL_FIELDS.has(field) && value !== undefined &&
    !freeFields.includes(field) && !recordFieldEqual(field, before.get(field), value));
}

/** Add operation-field issues without changing the refusal's message or metadata. */
export async function withLockedFieldIssues<T>(work: () => Promise<T>, previous: object, changes: object): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'certification_locked') throw error;
    const issues = changedRecordFields(previous, changes).map(([field]) => ({ path: [field], code: 'certification_locked', message: error.message }));
    throw new DomainError(error.code, error.message, { ...error, issues: [...error.issues, ...issues], cause: error });
  }
}

/** Compare only changed input fields; form resubmissions may include unchanged protected facts. */
export function assertRecordLockFields(lock: RecordLock, previous: object, changes: object, refusal = 'This record cannot be changed.'): void {
  if (lock.level === 'open') return;
  const blocked = changedRecordFields(previous, changes, lock.freeFields);
  if (lock.level !== 'sent' && !blocked.length) return;
  const message = withRecordLockGuidance(refusal, lock);
  throw new DomainError('certification_locked', message, {
    issues: blocked.map(([field]) => ({ path: [field], code: 'certification_locked', message })),
  });
}
