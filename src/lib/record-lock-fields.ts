import { DomainError } from './domain-errors';
import { withRecordLockGuidance, type RecordLock } from './record-lock';

/** Compare only changed input fields; form resubmissions may include unchanged protected facts. */
export function assertRecordLockFields(lock: RecordLock, previous: object, changes: object, refusal = 'This record cannot be changed.'): void {
  if (lock.level === 'open') return;
  const before = new Map(Object.entries(previous));
  const blocked = Object.entries(changes).filter(([field, value]) => field !== 'expectedVersion' && value !== undefined &&
    !lock.freeFields.includes(field) && JSON.stringify(value) !== JSON.stringify(before.get(field)));
  if (lock.level !== 'sent' && !blocked.length) return;
  const message = withRecordLockGuidance(refusal, lock);
  throw new DomainError('certification_locked', message, {
    issues: blocked.map(([field]) => ({ path: [field], code: 'certification_locked', message })),
  });
}
