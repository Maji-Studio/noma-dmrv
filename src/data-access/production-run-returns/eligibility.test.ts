import { beforeEach, expect, it, vi } from 'vitest';
import { SafeError } from '@/lib/errors';
import { getProductionRunReturnEligibility } from './eligibility';

const mocks = vi.hoisted(() => ({ source: vi.fn(), locks: vi.fn(), history: vi.fn(), dependents: vi.fn(), allowance: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('../certification-lineage-guards', () => ({ getRecordLocks: mocks.locks }));
vi.mock('../record-lock-dependents', () => ({ readRecordDependents: mocks.dependents }));
vi.mock('./queries', () => ({ readReturnSource: mocks.source, getProductionRunReturnHistory: mocks.history, getProductionRunReturnAllowance: mocks.allowance }));
const ctx = { userId: 'actor', organizationId: 'org', orgRole: 'member' as const, isPlatformAdmin: false };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.source.mockResolvedValue({});
  mocks.locks.mockResolvedValue([{ level: 'open', howToFree: null }]);
  mocks.history.mockResolvedValue([{ id: 'return' }]);
  mocks.dependents.mockResolvedValue([{ kind: 'stockEntry', id: 'return' }]);
  mocks.allowance.mockResolvedValue({ consumedDryKg: 80, remainingDryKg: 40, returnedFeedstockTypeId: 'type' });
});

it('allows another return despite an active return dependency and reports the remaining dry cap', async () => {
  expect(await getProductionRunReturnEligibility(ctx, 'run')).toEqual({ eligible: true, code: null, blocker: null,
    consumedDryKg: 80, returnedDryKg: 40, remainingDryKg: 40, returnedFeedstockTypeId: 'type' });
});
it('checks Sent before a mutable consumption refusal', async () => {
  mocks.locks.mockResolvedValue([{ level: 'sent', howToFree: 'Wait for the statement to be returned.' }]);
  expect(await getProductionRunReturnEligibility(ctx, 'run')).toMatchObject({ eligible: false, code: 'certification_locked' });
  expect(mocks.allowance).not.toHaveBeenCalled();
});
it('refuses a non-return stock dependency', async () => {
  mocks.dependents.mockResolvedValue([{ kind: 'stockEntry', id: 'other' }]);
  expect(await getProductionRunReturnEligibility(ctx, 'run')).toMatchObject({ eligible: false, code: 'certification_locked' });
});
it('reports exhausted allowance without hiding its measured quantities', async () => {
  mocks.allowance.mockResolvedValue({ consumedDryKg: 80, remainingDryKg: 0, returnedFeedstockTypeId: 'type' });
  expect(await getProductionRunReturnEligibility(ctx, 'run')).toMatchObject({ eligible: false, code: 'ineligible', remainingDryKg: 0, returnedDryKg: 80 });
});
it('returns expected source eligibility refusals but propagates unexpected reader failures', async () => {
  mocks.allowance.mockRejectedValueOnce(new SafeError('Correct the moisture.'));
  expect(await getProductionRunReturnEligibility(ctx, 'run')).toMatchObject({ eligible: false, blocker: 'Correct the moisture.' });
  mocks.allowance.mockRejectedValueOnce(new Error('Database failed'));
  await expect(getProductionRunReturnEligibility(ctx, 'run')).rejects.toThrow('Database failed');
});
it('requires organization scope and source ownership before disclosing eligibility', async () => {
  await expect(getProductionRunReturnEligibility({ ...ctx, organizationId: '' }, 'run')).rejects.toThrow('Unauthorized');
  expect(mocks.source).not.toHaveBeenCalled();
  mocks.source.mockRejectedValue(new SafeError('Production run not found.'));
  await expect(getProductionRunReturnEligibility(ctx, 'foreign-run')).rejects.toThrow('not found');
  expect(mocks.locks).not.toHaveBeenCalled();
});
