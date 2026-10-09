import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lockRoutes: vi.fn(), lockRequest: vi.fn(), findRequest: vi.fn(), lockBins: vi.fn(), prepare: vi.fn() }));
const tx = {};
vi.mock('@/db', () => ({ db: { transaction: async (run: (tx: unknown) => unknown) => run(tx) } }));
vi.mock('./utils', () => ({ requireOrgScope: vi.fn() }));
vi.mock('./bin-movement-requests', () => ({ lockMovementRequest: mocks.lockRequest, findMovementRequest: mocks.findRequest }));
vi.mock('./lock-bin-stocks', () => ({ lockBinStocks: mocks.lockBins }));
vi.mock('./transport-legs', () => ({ lockBiocharTransportRouteTopology: mocks.lockRoutes, syncBiocharProductTransportLegs: vi.fn() }));
vi.mock('./output-stock-operations', () => ({ prepareOutputStock: mocks.prepare, postedMoisturePercent: vi.fn(), stockFingerprint: vi.fn() }));
import { withOutputStockPosting } from './output-stock-post';
import { OutputStockShortageError, StockBasisChangedError } from './output-stock-errors';
import { SafeError } from '@/lib/errors';

const ctx = { organizationId: 'org', userId: 'operator', orgRole: 'owner' as const, isPlatformAdmin: false };
const input = { storageLocationId: 'source', facilityId: 'facility', occurredAt: '2026-09-14T12:00:00.000Z', kind: 'delivery' as const,
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

describe('posting refusals under the locks', () => {
  const post = () => withOutputStockPosting(ctx, { input, replay: vi.fn(), write: async (_tx, persist) => persist() });
  const prepared = (overrides: Record<string, unknown>) => ({ bin: { id: 'source', code: 'BC-1' }, layers: [], readings: [], correction: null,
    plan: null, blocking: null, preview: { basisFingerprint: 'basis', blockingMessage: null }, ...overrides });

  it('refuses a moved stock basis as the same refresh conflict, now typed', async () => {
    mocks.prepare.mockResolvedValue(prepared({ preview: { basisFingerprint: 'moved', blockingMessage: null } }));
    const refusal = await post().catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(StockBasisChangedError);
    expect(refusal).toMatchObject({ name: 'ActionConflictError', message: 'Stock changed since this preview. Refresh the preview and try again.',
      conflict: { entity: 'storageLocation', id: 'source', code: 'BC-1' } });
  });

  it('refuses a capacity failure with the blocking message, typed as a shortage', async () => {
    const message = 'Not enough dry biochar in the selected bin for this wet mass at this moisture. Reduce the wet mass or choose another bin.';
    mocks.prepare.mockResolvedValue(prepared({ preview: { basisFingerprint: 'basis', blockingMessage: message },
      blocking: { kind: 'insufficient_stock', storageLocationId: 'source', availableSolidsKg: 50, requestedSolidsKg: 90 } }));
    const refusal = await post().catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(OutputStockShortageError);
    expect(refusal).toMatchObject({ message, details: { storageLocationId: 'source', availableSolidsKg: 50, requestedSolidsKg: 90 } });
  });

  it('keeps an invalid request a plain refusal with its blocking message', async () => {
    const message = 'This load is used up before it reaches RUN-2. Untick RUN-2.';
    mocks.prepare.mockResolvedValue(prepared({ preview: { basisFingerprint: 'basis', blockingMessage: message }, blocking: { kind: 'invalid_request' } }));
    const refusal = await post().catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(SafeError);
    expect(refusal).not.toBeInstanceOf(OutputStockShortageError);
    expect(refusal).toMatchObject({ message });
  });
});
