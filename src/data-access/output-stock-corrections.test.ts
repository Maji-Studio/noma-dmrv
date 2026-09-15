import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import { ActionConflictError } from '@/lib/errors';
import type { OutputStockLayer } from '@/lib/output-stock';

const mocks = vi.hoisted(() => ({ projection: vi.fn(), where: vi.fn() }));
vi.mock('./output-stock', () => ({ getOutputStockAllocationProjection: mocks.projection }));
vi.mock('@/db', () => ({ db: {} }));
import { prepareOutputCorrection } from './output-stock-corrections';

const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
const reader = { select: () => ({ from: () => ({ where: mocks.where }) }) } as unknown as Pick<DbTransaction, 'select'>;
const input = { storageLocationId: 'bin', facilityId: 'facility', physicalDate: '2026-09-14', kind: 'loss' as const, wetMassKg: 10, moisturePercent: 10, correctsMovementId: 'original' };
const original = { id: 'original', outputKind: 'loss', postingSequence: BigInt(1) };
const allocation = { id: 'allocation', productionRunId: 'run', biocharProductId: null, deliveryId: 'delivery' };
const layers = [{ id: 'run', physicalDate: '2026-09-01' }] as OutputStockLayer[];

beforeEach(() => {
  mocks.where.mockReset().mockResolvedValueOnce([original]).mockResolvedValueOnce([]);
  mocks.projection.mockReset().mockResolvedValue([{ movement: original, allocation }]);
});

describe('correction dependency identities', () => {
  it('keeps the hard later-movement guard and includes the movement identity', async () => {
    mocks.projection.mockResolvedValue([{ movement: original, allocation }, { movement: { id: 'later', reason: 'Later loss', outputKind: 'loss', postingSequence: BigInt(2), physicalDate: '2026-09-12' }, allocation }]);
    await expect(prepareOutputCorrection(ctx, input, layers, reader)).rejects.toMatchObject({ conflict: { entity: 'binMovement', id: 'later', code: 'Later loss (2026-09-12)' } });
  });
  it('identifies a later balance-dependent count without draw allocations', async () => {
    mocks.where.mockResolvedValueOnce([{ id: 'count', outputKind: 'count', physicalDate: '2026-09-12' }]);
    await expect(prepareOutputCorrection(ctx, input, layers, reader)).rejects.toMatchObject({ conflict: { entity: 'binMovement', id: 'count', code: 'Count 2026-09-12' } });
  });
  it('keeps the application guard and returns its saved code and id', async () => {
    mocks.where.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'application', code: 'APP-001' }]);
    const result = prepareOutputCorrection(ctx, input, layers, reader);
    await expect(result).rejects.toBeInstanceOf(ActionConflictError);
    await expect(result).rejects.toMatchObject({ conflict: { entity: 'application', id: 'application', code: 'APP-001' } });
  });
});
