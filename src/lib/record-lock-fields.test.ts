import { conflictCode } from "./conflict-ref";
import { DomainError } from "./domain-errors";
import { expect, it, vi } from 'vitest';
import { assertRecordLockFields, withLockedFieldIssues } from './record-lock-fields';
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

it('adds changed operation fields and preserves lineage refusal metadata', async () => {
  const error = new DomainError('certification_locked', 'Sent. Correct the Removal first.', { conflict: { entity: 'removal', id: 'removal-1', code: conflictCode('REM-1') } });
  await expect(withLockedFieldIssues(async () => { throw error; },
    { massWetKg: 125.005, notes: 'saved', distanceNote: null },
    { massWetKg: 125.00500001, notes: 'edited', distanceNote: null, vehicleId: undefined, expectedVersion: 2 },
  )).rejects.toMatchObject({ code: error.code, message: error.message, conflict: error.conflict,
    issues: [{ path: ['notes'], code: 'certification_locked', message: error.message }] });
});

it('preserves non-lock failures and successful results', async () => {
  const error = new DomainError('stale_version', 'Reload.');
  await expect(withLockedFieldIssues(async () => { throw error; }, {}, { notes: 'new' })).rejects.toBe(error);
  await expect(withLockedFieldIssues(async () => 'saved', {}, {})).resolves.toBe('saved');
});

it('compares source selections for Sent refusals without changing dependency-lock policy', async () => {
  const sources = [{ layerId: 'layer-1', moisturePercent: 10 }];
  const error = new DomainError('certification_locked', 'Sent.');
  const refuse = async () => { throw error; };
  await expect(withLockedFieldIssues(refuse, { sources }, { sources: [...sources] })).rejects.toMatchObject({ issues: [] });
  await expect(withLockedFieldIssues(refuse, { sources }, { sources: [{ ...sources[0], moisturePercent: 20 }] }))
    .rejects.toMatchObject({ issues: [{ path: ['sources'] }] });
  const lock = recordLocks.delivery({ removals: [], dependents: [{ kind: 'application', id: 'dependent' }] });
  expect(() => assertRecordLockFields(lock, { sources }, { sources: [] })).not.toThrow();
});

it('builds lazy snapshots only for certification refusals', async () => {
  const previous = vi.fn(async () => ({ notes: 'saved' }));
  const changes = vi.fn(() => ({ notes: 'edited' }));
  await expect(withLockedFieldIssues(async () => 'saved', previous, changes)).resolves.toBe('saved');
  const otherError = new DomainError('stale_version', 'Reload.');
  await expect(withLockedFieldIssues(async () => { throw otherError; }, previous, changes)).rejects.toBe(otherError);
  expect(previous).not.toHaveBeenCalled();
  expect(changes).not.toHaveBeenCalled();
  const refusal = new DomainError('certification_locked', 'Sent.');
  await expect(withLockedFieldIssues(async () => { throw refusal; }, previous, changes))
    .rejects.toMatchObject({ code: refusal.code, issues: [{ path: ['notes'] }] });
  expect(previous).toHaveBeenCalledTimes(1);
  expect(changes).toHaveBeenCalledTimes(1);
});
