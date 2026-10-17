import { expect, it } from 'vitest';
import { assertRecordLockFields } from './record-lock-fields';
import { recordLocks } from './record-lock';

it.each(Object.entries(recordLocks))('%s compares protected kilogram inputs at gram precision', (_kind, lockFor) => {
  const lock = lockFor({ removals: [], dependents: [{ kind: 'application', id: 'dependent' }] });
  const existing = { appliedWetMassKg: 0.125005 * 1000 };
  expect(() => assertRecordLockFields(lock, existing, { appliedWetMassKg: 125.005 })).not.toThrow();
  expect(() => assertRecordLockFields(lock, existing, { appliedWetMassKg: 125.006 })).toThrow();
});

it('does not round percentages, coordinates or other numbers to grams', () => {
  const lock = recordLocks.biocharProduct({ removals: [], dependents: [{ kind: 'delivery', id: 'dependent' }] });
  expect(() => assertRecordLockFields(lock, { moistureContentPercent: 12.000001 }, { moistureContentPercent: 12.000002 })).toThrow();
});
