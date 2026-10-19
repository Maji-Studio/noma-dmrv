import { describe, expect, it, vi } from 'vitest';
import { correctFeedstockLoss } from './feedstock-loss-corrections';
import type { OrgContext } from '@/lib/auth/server';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn() }));
vi.mock('@/db', () => ({ db: mocks }));

const ctx: OrgContext = {
  userId: 'member', organizationId: 'org', orgRole: 'member', isPlatformAdmin: false,
};
const BIN_ID = 'bin';
const BIN_CODE = 'FB-001';
const input = {
  storageLocationId: BIN_ID, correctsMovementId: 'loss', idempotencyKey: 'request',
  reason: 'Corrected scale reading', replacement: null,
};
const REPLAY_CONFLICT_MESSAGE =
  'Lost mass was not changed because this request was already saved with different values. Close the form and start again.';
const REQUEST_CONSTRAINT = 'bin_movements_org_idempotency_unique';

describe('feedstock loss correction request conflicts', () => {
  it.each([false, true])('maps an idempotency unique violation to a bin conflict (wrapped: %s)', async wrapped => {
    const violation = { code: '23505', constraint: REQUEST_CONSTRAINT };
    mocks.transaction.mockRejectedValueOnce(wrapped ? { cause: violation } : violation);
    mocks.select.mockReturnValue({ from: () => ({ where: async () => [{ code: BIN_CODE }] }) });

    await expect(correctFeedstockLoss(ctx, input)).rejects.toMatchObject({
      name: 'ActionConflictError', message: REPLAY_CONFLICT_MESSAGE,
      conflict: { entity: 'storageLocation', id: BIN_ID, code: BIN_CODE },
    });
  });

  it.each([
    { code: '23505', constraint: 'another_unique_constraint' },
    { code: '23514', constraint: REQUEST_CONSTRAINT },
  ])('preserves unrelated database errors: $code / $constraint', async error => {
    mocks.transaction.mockRejectedValueOnce(error);
    await expect(correctFeedstockLoss(ctx, input)).rejects.toBe(error);
  });
});
