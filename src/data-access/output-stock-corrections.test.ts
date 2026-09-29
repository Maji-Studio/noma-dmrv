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
const input = { storageLocationId: 'bin', facilityId: 'facility', occurredAt: '2026-09-14T12:00:00.000Z', kind: 'loss' as const, wetMassKg: 10, moisturePercent: 10, correctsMovementId: 'original' };
const original = { id: 'original', outputKind: 'loss', postingSequence: BigInt(1) };
const bin = { code: 'BIN-01' };
const binConflict = { entity: 'storageLocation', id: 'bin', code: 'BIN-01' };
const allocation = { id: 'allocation', productionRunId: 'run', biocharProductId: null, deliveryId: 'delivery' };
const layers = [{ id: 'run', placedAt: '2026-09-01T12:00:00.000Z' }] as OutputStockLayer[];

beforeEach(() => {
  // Reads in order: the original movement, the already-corrected probe, then the bin the conflict points at.
  mocks.where.mockReset().mockResolvedValueOnce([original]).mockResolvedValueOnce([]).mockResolvedValueOnce([bin]);
  mocks.projection.mockReset().mockResolvedValue([{ movement: original, allocation }]);
});

describe('correction dependency identities', () => {
  it('points a later-movement refusal at the bin and lists the movement as a blocker', async () => {
    mocks.projection.mockResolvedValue([{ movement: original, allocation }, { movement: { id: 'later', reason: 'Later loss', outputKind: 'loss', postingSequence: BigInt(2), occurredAt: new Date('2026-09-12T12:00:00.000Z') }, allocation }]);
    mocks.where.mockResolvedValueOnce([{ timezone: 'UTC' }]);
    await expect(prepareOutputCorrection(ctx, input, layers, reader)).rejects.toMatchObject({ conflict: binConflict, blockers: [{ entity: 'binMovement', id: 'later', code: 'Later loss (Sep 12, 2026, 12:00)' }] });
  });
  it('identifies a later balance-dependent count without draw allocations', async () => {
    mocks.where.mockResolvedValueOnce([{ id: 'count', outputKind: 'count', occurredAt: new Date('2026-09-12T12:00:00.000Z') }]).mockResolvedValueOnce([{ timezone: 'Africa/Dar_es_Salaam' }]);
    await expect(prepareOutputCorrection(ctx, input, layers, reader)).rejects.toMatchObject({ conflict: binConflict, blockers: [{ entity: 'binMovement', id: 'count', code: 'Count (Sep 12, 2026, 15:00)' }] });
  });
  it('keeps the application guard and returns its saved code and id', async () => {
    mocks.where.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'application', code: 'APP-001' }]);
    const result = prepareOutputCorrection(ctx, input, layers, reader);
    await expect(result).rejects.toBeInstanceOf(ActionConflictError);
    await expect(result).rejects.toMatchObject({ conflict: { entity: 'application', id: 'application', code: 'APP-001' } });
  });
});
