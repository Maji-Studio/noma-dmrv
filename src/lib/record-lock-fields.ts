import { massGrams } from './calculations/gram-allocation';
import { DomainError } from './domain-errors';
import { withRecordLockGuidance, type RecordLock } from './record-lock';

const RECORD_LOCK_CONTROL_FIELDS = new Set(['expectedVersion', 'idempotencyKey', 'correctsMovementId', 'basisFingerprint', 'sources']);

/** Mass inputs and database projections agree at the ledger's gram precision. */
export function recordFieldEqual(field: string, previous: unknown, next: unknown): boolean {
  if (field.endsWith('Kg') && typeof previous === 'number' && typeof next === 'number') return massGrams(previous) === massGrams(next);
  return JSON.stringify(previous) === JSON.stringify(next);
}

/** Compare only changed input fields; form resubmissions may include unchanged protected facts. */
export function assertRecordLockFields(lock: RecordLock, previous: object, changes: object, refusal = 'This record cannot be changed.'): void {
  if (lock.level === 'open') return;
  const before = new Map(Object.entries(previous));
  const blocked = Object.entries(changes).filter(([field, value]) => !RECORD_LOCK_CONTROL_FIELDS.has(field) && value !== undefined &&
    !lock.freeFields.includes(field) && !recordFieldEqual(field, before.get(field), value));
  if (lock.level !== 'sent' && !blocked.length) return;
  const message = withRecordLockGuidance(refusal, lock);
  throw new DomainError('certification_locked', message, {
    issues: blocked.map(([field]) => ({ path: [field], code: 'certification_locked', message })),
  });
}
