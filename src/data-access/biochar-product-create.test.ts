import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conflictCode } from "@/lib/conflict-ref";
import { ActionConflictError, SafeError } from '@/lib/errors';
import { OutputStockShortageError } from './output-stock-errors';

const mocks = vi.hoisted(() => ({
  posting: vi.fn(), revalidate: vi.fn(), persist: vi.fn(), insert: vi.fn(), select: vi.fn(),
  sourceAllocations: vi.fn(), validate: vi.fn(), assertStock: vi.fn(), transaction: vi.fn(),
}));
const tx = { transaction: 'caller' };
vi.mock('@/db', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('./utils', () => ({ requireOrgScope: vi.fn() }));
vi.mock('./product-stock-preview', () => ({ revalidateProductStock: mocks.revalidate }));
vi.mock('./biochar-product-composition', () => ({
  deriveCompositionSourceBiocharMassKg: () => 100,
  getCompositionIngredientDraws: () => [{ storageLocationId: 'ingredient', massKg: 20 }],
  validateCompositionIngredientBins: mocks.validate, assertCompositionIngredientDrawsWithinStock: mocks.assertStock,
}));
vi.mock('./biochar-product-source-allocations', () => ({ insertBiocharProductSourceAllocations: mocks.sourceAllocations }));
vi.mock('./output-stock-post', () => ({ withOutputStockPostingInTransaction: mocks.posting }));
vi.mock('./output-bin-stock-mode', () => ({ assertAdditionAfterSplit: vi.fn() }));
import { createBiocharProduct, createBiocharProductInTransaction } from './biochar-product-create';
import type { DbTransaction } from '@/db';

const ctx = { organizationId: 'org', userId: 'operator', orgRole: 'owner' as const, isPlatformAdmin: false };
const data = { code: 'BP-1', facilityId: 'facility', formulationId: 'recipe', placedAt: '2026-09-14T12:00:00.000Z',
  idempotencyKey: 'request', basisFingerprint: 'aggregate', sourceBiocharStorageLocationId: 'source', storageLocationId: 'destination',
  massKg: 120, moistureContentPercent: 10, waterAddedKg: 0, composition: { ingredients: [{ storageLocationId: 'ingredient', massKg: 20 }] } };

beforeEach(() => {
  vi.resetAllMocks();
  const rows = [[{ id: 'facility' }], [{ id: 'recipe', biocharRatio: 1 }], [{ id: 'destination', formulationId: 'recipe' }], [{ date: '2026-09-13' }], [{ productionRunId: 'run', wetMassKg: '100' }]];
  mocks.select.mockImplementation(() => {
    const result = rows.shift();
    const query = { from: () => query, where: () => query, for: async () => result, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  });
  mocks.insert.mockReturnValue({ values: () => ({ returning: async () => [{ id: 'product' }] }) });
  mocks.transaction.mockImplementation(async (run: (caller: unknown) => unknown) => run(tx));
  mocks.revalidate.mockResolvedValue({ basisFingerprint: 'product-basis', composition: { ingredients: [] }, source: {
    preview: { basisFingerprint: 'source-only', blockingMessage: null, allocations: [{ layerId: 'run', dryMassKg: 90 }] },
    plan: { allocations: [{ layerId: 'run' }] }, layers: [{ id: 'run', placedAt: '2026-09-13T12:00:00.000Z' }], input: { moisturePercent: 10 },
  } });
  mocks.persist.mockResolvedValue({ movement: { id: 'movement' } });
  // Stands in for a first-time request: every lock is held, so the write runs.
  mocks.posting.mockImplementation((_ctx, _tx, posting) => posting.write({ select: mocks.select, insert: mocks.insert }, mocks.persist));
});

describe('locked product preview revalidation', () => {
  it('names every affected bin to the posting scope and rejects stale basis before any writes', async () => {
    mocks.revalidate.mockRejectedValue(new ActionConflictError('Stock changed', { entity: 'storageLocation', id: 'ingredient', code: conflictCode('FB-001') }));
    await expect(createBiocharProduct(ctx, data)).rejects.toMatchObject({ name: 'ActionConflictError' });
    expect(mocks.posting).toHaveBeenCalledWith(ctx, tx, expect.objectContaining({ input: expect.objectContaining({ storageLocationId: 'source' }), additionalBinIds: ['destination', 'ingredient'] }), { snapshotStock: undefined });
    expect(mocks.revalidate).toHaveBeenCalledWith(ctx, expect.objectContaining({ massKg: 100, ingredientBins: data.composition.ingredients }), expect.anything(), 'aggregate');
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it('checks the source plan against its own basis and records the product-wide basis', async () => {
    await expect(createBiocharProduct(ctx, data)).resolves.toEqual({ id: 'product' });
    expect(mocks.revalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.insert.mock.invocationCallOrder[0]);
    expect(mocks.persist).toHaveBeenCalledWith({ targetBiocharProductId: 'product', basisFingerprint: 'source-only', recordedBasisFingerprint: 'product-basis' });
  });
  it('refuses a short source with the planner message, typed as a shortage, before any writes', async () => {
    const message = 'Not enough dry biochar in the selected bin for this wet mass at this moisture. Reduce the wet mass or choose another bin.';
    const blocking = { kind: 'insufficient_stock', storageLocationId: 'source', availableSolidsKg: 80, requestedSolidsKg: 90 };
    mocks.transaction.mockImplementation(async (run: (caller: unknown) => unknown) => run(tx));
  mocks.revalidate.mockResolvedValue({ basisFingerprint: 'product-basis', composition: { ingredients: [] }, source: { preview: { basisFingerprint: 'source-only', blockingMessage: message, allocations: [] }, plan: null, blocking, layers: [], input: {} } });
    const refusal = await createBiocharProduct(ctx, data).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(OutputStockShortageError);
    expect(refusal).toMatchObject({ message, details: { storageLocationId: 'source', availableSolidsKg: 80, requestedSolidsKg: 90 } });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it('keeps a source refusal that is not a shortage a plain refusal', async () => {
    const message = 'This load is used up before it reaches RUN-2. Untick RUN-2.';
    mocks.transaction.mockImplementation(async (run: (caller: unknown) => unknown) => run(tx));
  mocks.revalidate.mockResolvedValue({ basisFingerprint: 'product-basis', composition: { ingredients: [] }, source: { preview: { basisFingerprint: 'source-only', blockingMessage: message, allocations: [] }, plan: null, blocking: { kind: 'invalid_request' }, layers: [], input: {} } });
    const refusal = await createBiocharProduct(ctx, data).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(SafeError);
    expect(refusal).not.toBeInstanceOf(OutputStockShortageError);
    expect(refusal).toMatchObject({ message });
  });
});

describe('creating inside a caller transaction', () => {
  const snapshotStock = vi.fn();
  const callerTx = { caller: true } as unknown as DbTransaction;

  it('posts on the caller transaction with its snapshot observer and returns the product basis', async () => {
    await expect(createBiocharProductInTransaction(ctx, callerTx, data, { snapshotStock })).resolves.toEqual({ product: { id: 'product' }, basisFingerprint: 'product-basis' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.posting).toHaveBeenCalledWith(ctx, callerTx, expect.anything(), { snapshotStock });
  });

  it('acts on current stock when no fingerprint was sent', async () => {
    const { basisFingerprint: _sent, ...current } = data;
    void _sent;
    await createBiocharProductInTransaction(ctx, callerTx, current);
    expect(mocks.revalidate).toHaveBeenCalledWith(ctx, expect.anything(), expect.anything(), undefined);
  });

  it('refuses a future placement before taking any lock, and accepts one at the server clock', async () => {
    const now = new Date(data.placedAt);
    const refusal = await createBiocharProductInTransaction(ctx, callerTx, { ...data, placedAt: '2026-09-14T12:00:00.001Z' }, { now }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: 'validation_failed', message: 'Placement time cannot be in the future. Enter a time at or before now.', issues: [{ path: ['placedAt'] }] });
    expect(mocks.posting).not.toHaveBeenCalled();
    await expect(createBiocharProductInTransaction(ctx, callerTx, data, { now })).resolves.toMatchObject({ product: { id: 'product' } });
  });
});
