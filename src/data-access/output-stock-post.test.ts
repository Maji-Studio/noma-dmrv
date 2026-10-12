import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lockRoutes: vi.fn(), lockRequest: vi.fn(), findRequest: vi.fn(), lockBins: vi.fn(), prepare: vi.fn(),
  transaction: vi.fn(), changed: vi.fn(), assertLayers: vi.fn() }));
const tx = {};
vi.mock('@/db', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('./utils', () => ({ requireOrgScope: vi.fn() }));
vi.mock('./bin-movement-requests', () => ({ lockMovementRequest: mocks.lockRequest, findMovementRequest: mocks.findRequest }));
vi.mock('./lock-bin-stocks', () => ({ lockBinStocks: mocks.lockBins }));
vi.mock('./transport-legs', () => ({ lockBiocharTransportRouteTopology: mocks.lockRoutes, syncBiocharProductTransportLegs: vi.fn() }));
vi.mock('./output-stock-operations', () => ({ prepareOutputStock: mocks.prepare, postedMoisturePercent: vi.fn(), stockFingerprint: vi.fn() }));
vi.mock('./output-stock-lineage', () => ({ changedOutputLayerIds: mocks.changed, assertOutputLayersMutable: mocks.assertLayers }));
import type { DbTransaction } from '@/db';
import { readOutputStockBin, recordOutputStockMovementInTransaction, withOutputStockPosting, withOutputStockPostingInTransaction } from './output-stock-post';
import { OutputStockShortageError, StockBasisChangedError } from './output-stock-errors';
import { DomainError } from '@/lib/domain-errors';
import { SafeError } from '@/lib/errors';

const ctx = { organizationId: 'org', userId: 'operator', orgRole: 'owner' as const, isPlatformAdmin: false };
const input = { storageLocationId: 'source', facilityId: 'facility', occurredAt: '2026-09-14T12:00:00.000Z', kind: 'delivery' as const,
  wetMassKg: 100, moisturePercent: 10, idempotencyKey: 'request', basisFingerprint: 'basis', reason: 'Delivery D-1' };
const order = (mock: ReturnType<typeof vi.fn>) => mock.mock.invocationCallOrder[0];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(tx));
});

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

describe('posting inside a caller transaction', () => {
  it('uses the caller transaction and snapshots every locked bin once, after the bin locks and before the write', async () => {
    const snapshotStock = vi.fn();
    const write = vi.fn().mockResolvedValue('written');
    const callerTx = {} as DbTransaction;
    await expect(withOutputStockPostingInTransaction(ctx, callerTx, { input, additionalBinIds: ['destination', null], locksTransportRoutes: true, replay: vi.fn(), write }, { snapshotStock })).resolves.toBe('written');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(snapshotStock).toHaveBeenCalledTimes(1);
    expect(snapshotStock).toHaveBeenCalledWith(callerTx, ['source', 'destination', null]);
    expect(order(mocks.lockBins)).toBeLessThan(order(snapshotStock));
    expect(order(snapshotStock)).toBeLessThan(order(write));
  });

  it('takes no snapshot when the key replays', async () => {
    const snapshotStock = vi.fn();
    mocks.findRequest.mockResolvedValue({ id: 'movement' });
    await withOutputStockPostingInTransaction(ctx, {} as DbTransaction, { input, replay: async () => 'replayed', write: vi.fn() }, { snapshotStock });
    expect(snapshotStock).not.toHaveBeenCalled();
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
      blocking: { kind: 'insufficient_stock', storageLocationId: 'source', measure: 'dry_biochar', availableSolidsKg: 50, requestedSolidsKg: 90 } }));
    const refusal = await post().catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(OutputStockShortageError);
    expect(refusal).toMatchObject({ message, details: { storageLocationId: 'source', measure: 'dry_biochar', availableSolidsKg: 50, requestedSolidsKg: 90 } });
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

describe('optional stock basis (decision 53)', () => {
  const { basisFingerprint: _omitted, ...current } = input;
  void _omitted;
  const prepared = (overrides: Record<string, unknown>) => ({ bin: { id: 'source', code: 'BC-1' }, lane: 'biochar', layers: [], readings: [], correction: null,
    plan: null, blocking: null, preview: { basisFingerprint: 'moved', blockingMessage: null }, ...overrides });

  it('acts on current stock without a fingerprint, so only the planner can refuse', async () => {
    mocks.prepare.mockResolvedValue(prepared({ preview: { basisFingerprint: 'moved', blockingMessage: 'Short.' },
      blocking: { kind: 'insufficient_stock', storageLocationId: 'source', measure: 'dry_biochar', availableSolidsKg: 1, requestedSolidsKg: 2 } }));
    const refusal = await withOutputStockPosting(ctx, { input: current, replay: vi.fn(), write: async (_tx, persist) => persist() }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(OutputStockShortageError);
  });
});

describe('lineage of changed layers (decision 51)', () => {
  const count = { ...input, kind: 'count' as const, wetMassKg: 500, moisturePercent: 20 };
  const planned = { bin: { id: 'source', code: 'BC-1' }, lane: 'biochar', layers: [{ id: 'run' }], readings: [{ layerId: 'run' }], correction: null,
    plan: { allocations: [] }, blocking: null, preview: { basisFingerprint: 'basis', blockingMessage: null } };

  it('refuses a zero-draw count on certified layers before any product lock or write', async () => {
    mocks.prepare.mockResolvedValue(planned);
    mocks.changed.mockResolvedValue(['run']);
    mocks.assertLayers.mockRejectedValue(new DomainError('certification_locked', 'Production run is locked by a certification submission.'));
    await expect(withOutputStockPosting(ctx, { input: count, replay: vi.fn(), write: async (_tx, persist) => persist() }))
      .rejects.toMatchObject({ code: 'certification_locked' });
    expect(mocks.assertLayers).toHaveBeenCalledWith(ctx, tx, 'biochar', ['run']);
  });

  it('leaves forward draws by deliveries and products to their own guards', async () => {
    mocks.prepare.mockResolvedValue({ ...planned, readings: [], plan: { allocations: [{ layerId: 'run' }] } });
    mocks.changed.mockResolvedValue(['run']);
    await withOutputStockPosting(ctx, { input, replay: vi.fn(), write: async (_tx, persist) => persist() }).catch(() => undefined);
    expect(mocks.changed).toHaveBeenCalled();
    expect(mocks.assertLayers).toHaveBeenCalledWith(ctx, tx, 'biochar', []);
  });

  it('still guards a reading that any other posting would reset', async () => {
    mocks.prepare.mockResolvedValue({ ...planned, layers: [{ id: 'run' }, { id: 'read' }], readings: [{ layerId: 'read' }], plan: { allocations: [{ layerId: 'run' }] } });
    mocks.changed.mockResolvedValue(['run', 'read']);
    mocks.assertLayers.mockRejectedValue(new DomainError('certification_locked', 'Production run is locked by a certification submission.'));
    await expect(withOutputStockPosting(ctx, { input, replay: vi.fn(), write: async (_tx, persist) => persist() }))
      .rejects.toMatchObject({ code: 'certification_locked' });
    expect(mocks.assertLayers).toHaveBeenCalledWith(ctx, tx, 'biochar', ['read']);
  });
});

describe('recording a movement', () => {
  const now = new Date('2026-09-14T12:00:00.000Z');
  const command = { ...input, storageLocationId: '00000000-0000-4000-8000-000000000001', facilityId: '00000000-0000-4000-8000-000000000002',
    kind: 'loss' as const, expectedProductVersions: {}, occurredAt: now.toISOString() };

  it('refuses a future time before taking any lock', async () => {
    const refusal = await recordOutputStockMovementInTransaction(ctx, tx as DbTransaction, { ...command, occurredAt: '2026-09-14T12:00:00.001Z' }, { now }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: 'validation_failed', message: 'Date and time cannot be in the future. Enter a time at or before now.', issues: [{ path: ['occurredAt'] }] });
    expect(mocks.lockRequest).not.toHaveBeenCalled();
  });

  it('accepts a time exactly at the server clock and posts on the caller transaction', async () => {
    mocks.prepare.mockRejectedValue(new Error('stop after the locks'));
    await expect(recordOutputStockMovementInTransaction(ctx, tx as DbTransaction, command, { now })).rejects.toThrow('stop after the locks');
    expect(mocks.lockRoutes).toHaveBeenCalled();
    expect(mocks.lockRequest).toHaveBeenCalledWith(ctx, tx, 'request');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('refuses deliveries and product draws that are not corrections', async () => {
    await expect(recordOutputStockMovementInTransaction(ctx, tx as DbTransaction, { ...command, kind: 'delivery' }, { now })).rejects.toMatchObject({ code: 'validation_failed', issues: [{ path: ['kind'] }] });
    await expect(recordOutputStockMovementInTransaction(ctx, tx as DbTransaction, { ...command, kind: 'production_draw' }, { now })).rejects.toMatchObject({ code: 'validation_failed' });
    expect(mocks.lockRequest).not.toHaveBeenCalled();
  });
});

describe('reading the named bin', () => {
  const reader = (rows: unknown[]) => ({ select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => rows }) }) }) }) as unknown as DbTransaction;
  const bin = { id: 'source', facilityId: 'facility', type: 'biochar_bin', timeZone: 'Africa/Dar_es_Salaam' };

  it('returns the facility and its zone', async () => {
    await expect(readOutputStockBin(ctx, reader([bin]), { storageLocationId: 'source' })).resolves.toEqual({ id: 'source', facilityId: 'facility', timeZone: 'Africa/Dar_es_Salaam' });
  });

  it('answers a missing, archived or foreign bin, or one in another facility, as not found', async () => {
    await expect(readOutputStockBin(ctx, reader([]), { storageLocationId: 'source' })).rejects.toMatchObject({ code: 'not_found', issues: [{ path: ['storageLocationId'] }] });
    await expect(readOutputStockBin(ctx, reader([bin]), { storageLocationId: 'source', facilityId: 'other' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a feedstock bin', async () => {
    await expect(readOutputStockBin(ctx, reader([{ ...bin, type: 'feedstock_bin' }]), { storageLocationId: 'source' })).rejects.toMatchObject({ code: 'validation_failed', issues: [{ path: ['storageLocationId'] }] });
  });
});
