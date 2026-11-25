import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SafeError } from '@/lib/errors';
import { DomainError } from '@/lib/domain-errors';

const mocks = vi.hoisted(() => ({ context: vi.fn(), run: vi.fn(), history: vi.fn(), allowance: vi.fn(), eligibility: vi.fn(), balance: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireOrgContext: mocks.context }));
vi.mock('@/lib/operations/runner', () => ({ runOperationInProcess: mocks.run }));
vi.mock('@/lib/operations/production-run-returns', () => ({
  recordProductionRunReturn: { id: 'record_production_run_return' }, correctProductionRunReturn: { id: 'correct_production_run_return' },
}));
vi.mock('@/data-access/production-run-returns', () => ({ getProductionRunReturnHistory: mocks.history, getProductionRunReturnAllowance: mocks.allowance }));
vi.mock('@/data-access/production-run-returns/eligibility', () => ({ getProductionRunReturnEligibility: mocks.eligibility }));
vi.mock('@/data-access/production-run-material-balance', () => ({ getProductionRunMaterialBalance: mocks.balance }));

import { recordProductionRunReturnFn, correctProductionRunReturnFn, getProductionRunReturnHistoryFn, getProductionRunReturnAllowanceFn, getProductionRunReturnEligibilityFn, getProductionRunMaterialBalanceFn } from './production-run-returns';

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const BIN_ID = '00000000-0000-4000-8000-000000000002';
const ctx = { userId: 'actor', organizationId: 'org', orgRole: 'member', isPlatformAdmin: false };
const input = { sourceProductionRunId: RUN_ID, storageLocationId: BIN_ID, wetMassKg: 50, moisturePercent: 20,
  occurredAt: '2026-01-02T12:00:00Z', reason: 'Return measured material', idempotencyKey: 'draft-key' };

beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue(ctx); });

describe('production-run return action boundary', () => {
  it('uses session context and preserves the domain request key', async () => {
    mocks.run.mockResolvedValue({ id: 'movement' });
    expect(await recordProductionRunReturnFn(input)).toEqual({ success: true, data: { id: 'movement' } });
    expect(mocks.run).toHaveBeenCalledWith({ id: 'record_production_run_return' }, ctx, { ...input, occurredAt: '2026-01-02T12:00:00.000Z' });
    const correction = { sourceProductionRunId: RUN_ID, storageLocationId: BIN_ID, correctsMovementId: RUN_ID,
      reason: 'Reverse measurement', idempotencyKey: 'correction-key', replacement: null };
    await correctProductionRunReturnFn(correction);
    expect(mocks.run).toHaveBeenLastCalledWith({ id: 'correct_production_run_return' }, ctx, correction);
  });

  it('returns history with exact JSON-safe posting sequences and kg masses', async () => {
    const postingSequence = BigInt('9007199254740993');
    mocks.history.mockResolvedValue([{ id: 'movement', postingSequence, massDeltaKg: 50,
      feedstockDryDeltaKg: 40, inputSnapshot: { consumedDryKg: 80 } }]);
    const result = await getProductionRunReturnHistoryFn(RUN_ID);
    expect(result).toEqual({ success: true, data: [{ id: 'movement', postingSequence: '9007199254740993',
      massDeltaKg: 50, feedstockDryDeltaKg: 40, inputSnapshot: { consumedDryKg: 80 } }] });
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(mocks.history).toHaveBeenCalledWith(ctx, RUN_ID);
  });

  it('rejects invalid measurements and UUIDs before running writes or reads', async () => {
    expect(await recordProductionRunReturnFn({ ...input, wetMassKg: 0 })).toMatchObject({ success: false });
    expect(await getProductionRunReturnHistoryFn('invalid')).toMatchObject({ success: false });
    expect(await getProductionRunReturnEligibilityFn('invalid')).toMatchObject({ success: false });
    expect(await getProductionRunReturnAllowanceFn('invalid')).toMatchObject({ success: false });
    expect(await getProductionRunMaterialBalanceFn('invalid')).toMatchObject({ success: false });
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.eligibility).not.toHaveBeenCalled();
    expect(mocks.allowance).not.toHaveBeenCalled();
  });

  it('does not access reads or writes without authentication', async () => {
    mocks.context.mockRejectedValue(new SafeError('You must be signed in.'));
    for (const result of await Promise.all([recordProductionRunReturnFn(input), getProductionRunReturnHistoryFn(RUN_ID),
      getProductionRunReturnEligibilityFn(RUN_ID), getProductionRunReturnAllowanceFn(RUN_ID), getProductionRunMaterialBalanceFn(RUN_ID)])) {
      expect(result).toEqual({ success: false, error: 'You must be signed in.' });
    }
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.eligibility).not.toHaveBeenCalled();
    expect(mocks.allowance).not.toHaveBeenCalled();
  });

  it('preserves lock refusals and exposes only the public allowance fields', async () => {
    mocks.run.mockRejectedValue(new DomainError('certification_locked', 'Correct the dependent record first.'));
    expect(await recordProductionRunReturnFn(input)).toMatchObject({ success: false, code: 'certification_locked' });
    mocks.allowance.mockResolvedValue({ consumedDryKg: 80, remainingDryKg: 40, returnedFeedstockTypeId: 'type', run: { private: true } });
    expect(await getProductionRunReturnAllowanceFn(RUN_ID)).toEqual({ success: true,
      data: { consumedDryKg: 80, remainingDryKg: 40, returnedFeedstockTypeId: 'type' } });
    expect(mocks.allowance).toHaveBeenCalledWith(ctx, RUN_ID);
  });
});
