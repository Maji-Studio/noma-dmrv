import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lockRoutes: vi.fn(), lockRequest: vi.fn(), findRequest: vi.fn(), lockBins: vi.fn() }));
const tx = {};
vi.mock('@/db', () => ({ db: { transaction: async (run: (tx: unknown) => unknown) => run(tx) } }));
vi.mock('./utils', () => ({ requireOrgScope: vi.fn() }));
vi.mock('./bin-movement-requests', () => ({ lockMovementRequest: mocks.lockRequest, findMovementRequest: mocks.findRequest }));
vi.mock('./lock-bin-stocks', () => ({ lockBinStocks: mocks.lockBins }));
vi.mock('./transport-legs', () => ({ lockBiocharTransportRouteTopology: mocks.lockRoutes, syncBiocharProductTransportLegs: vi.fn() }));
import { withOutputStockPosting } from './output-stock-post';

const ctx = { organizationId: 'org', userId: 'operator', orgRole: 'owner' as const, isPlatformAdmin: false };
const input = { storageLocationId: 'source', facilityId: 'facility', physicalDate: '2026-09-14', kind: 'delivery' as const,
  wetMassKg: 100, moisturePercent: 10, idempotencyKey: 'request', basisFingerprint: 'basis', reason: 'Delivery D-1' };
const order = (mock: ReturnType<typeof vi.fn>) => mock.mock.invocationCallOrder[0];

beforeEach(() => vi.resetAllMocks());

describe('output stock posting scope', () => {
  it('locks routes, the request key, then every named bin before the write runs', async () => {
    const write = vi.fn().mockResolvedValue('written');
    const replay = vi.fn();
    await expect(withOutputStockPosting(ctx, { input, payload: { facts: 1 }, additionalBinIds: ['destination', null], locksTransportRoutes: true, replay, write })).resolves.toBe('written');
    expect(order(mocks.lockRoutes)).toBeLessThan(order(mocks.lockRequest));
    expect(order(mocks.lockRequest)).toBeLessThan(order(mocks.findRequest));
    expect(order(mocks.findRequest)).toBeLessThan(order(mocks.lockBins));
    expect(order(mocks.lockBins)).toBeLessThan(order(write));
    expect(mocks.findRequest).toHaveBeenCalledWith(ctx, tx, expect.objectContaining({ idempotencyKey: 'request', payload: { facts: 1 }, storageLocationId: 'source' }));
    expect(mocks.lockBins).toHaveBeenCalledWith(ctx, tx, ['source', 'destination', null]);
    expect(replay).not.toHaveBeenCalled();
  });
  it('replays a posted key without locking bins or writing', async () => {
    const existing = { id: 'movement' };
    mocks.findRequest.mockResolvedValue(existing);
    const write = vi.fn();
    await expect(withOutputStockPosting(ctx, { input, replay: async (_tx, posted) => posted.id, write })).resolves.toBe('movement');
    expect(mocks.lockRoutes).not.toHaveBeenCalled();
    expect(mocks.lockBins).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
