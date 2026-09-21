import { beforeEach, describe, expect, it, vi } from 'vitest';
import { outputStockPreviewSchema } from '@/schemas/output-stock';
import type { OutputStockPreview } from '@/types/output-stock';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), composition: vi.fn(), stock: vi.fn(), scope: vi.fn(), where: vi.fn() }));
vi.mock('@/db', () => ({ db: { transaction: async (run: (tx: unknown) => unknown) => run({ select: () => ({ from: () => ({ where: mocks.where }) }) }) } }));
vi.mock('./utils', () => ({ requireOrgScope: mocks.scope }));
vi.mock('./output-stock-operations', async () => {
  const { createHash } = await import('node:crypto');
  return { prepareOutputStock: mocks.prepare, stockFingerprint: (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex') };
});
vi.mock('./biochar-product-composition', () => ({ resolveCompositionIngredientMassBasis: mocks.composition }));
vi.mock('./ingredient-moisture-basis', () => ({ getIngredientStockBasis: mocks.stock }));
import { assertProductStockBasis, prepareProductStock, revalidateProductStock, previewProductStock, type ProductStockPreviewInput } from './product-stock-preview';

const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
const input: ProductStockPreviewInput = { facilityId: 'facility', formulationId: 'recipe', placedAt: '2026-09-14', sourceBiocharStorageLocationId: 'source', storageLocationId: 'destination', massKg: 100, moistureContentPercent: 10, waterAddedKg: 20, ingredientBins: [] };
const preview: OutputStockPreview = { storageLocationId: 'source', binName: 'Source', binCode: 'BC-1', lane: 'biochar', basisFingerprint: 'source-basis', beforeDryKg: 180, afterDryKg: 90, beforeSolidsKg: 180, afterSolidsKg: 90, removedDryKg: 90, removedWetKg: 100, estimateMoisturePercent: 10, beforeEstimatedWetKg: 200, afterEstimatedWetKg: 100, discrepancySolidsKg: 0, blockingMessage: null, allocations: [{ layerId: 'run', code: 'RUN-1', wetMassKg: 100, dryMassKg: 90, runs: [{ productionRunId: 'run', code: 'RUN-1', dryMassKg: 90 }] }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockReset().mockResolvedValueOnce({ preview, lane: 'biochar', bin: { id: 'source', code: 'BC-1' } }).mockResolvedValueOnce({ preview: { ...preview, storageLocationId: 'destination', lane: 'product', basisFingerprint: 'destination-basis', beforeDryKg: 50, beforeSolidsKg: 60, beforeEstimatedWetKg: 60, beforeAllocations: [{ layerId: 'existing', code: 'Existing', dryMassKg: 50, wetMassKg: 60, runs: [] }] }, lane: 'product', bin: { formulationId: 'recipe' } });
  mocks.composition.mockResolvedValue({ ingredients: [{ storageLocationId: 'ingredient', massKg: 30, massDryKg: 24 }, { storageLocationId: 'ingredient', massKg: 15, massDryKg: 12 }, { storageLocationId: null, massKg: 10, massDryKg: 8 }] });
  mocks.where.mockResolvedValue([{ id: 'ingredient', code: 'ING-1', name: 'Compost' }]);
  mocks.stock.mockResolvedValue({ wetMassKg: 150, dryMassKg: 140 });
});

describe('product stock preview', () => {
  it('groups tracked ingredient draws by physical bin and includes the receiving stock', async () => {
    const bins = await previewProductStock(ctx, input);
    expect(mocks.scope).toHaveBeenCalledWith(ctx);
    expect(bins.map(bin => bin.storageLocationId)).toEqual(['source', 'ingredient', 'destination']);
    expect(bins[0]).toEqual({ ...preview, basisFingerprint: expect.any(String) });
    expect(new Set(bins.map(bin => bin.basisFingerprint)).size).toBe(1);
    expect(bins[0].basisFingerprint).not.toBe(preview.basisFingerprint);
    expect(bins[1]).toMatchObject({ beforeEstimatedWetKg: 150, afterEstimatedWetKg: 105, beforeDryKg: 140, afterDryKg: 98, removedDryKg: 42, dryLabel: 'dry solids' });
    // Bin stock uses pro-rata intake solids, while the product retains its
    // override (36 kg) plus the untracked ingredient's 8 kg dry solids.
    expect(bins[2]).toMatchObject({ beforeDryKg: 50, afterDryKg: 140, beforeSolidsKg: 60, afterSolidsKg: 194, removedWetKg: -175 });
    expect(bins[2].afterAllocations?.map(layer => layer.layerId)).toEqual(['existing', 'proposed-product']);
    expect(mocks.stock).toHaveBeenCalledTimes(1);
    expect(bins[2].estimateMoisturePercent).toBeCloseTo((1 - 134 / 175) * 100);
    expect(bins[2].beforeEstimatedWetKg).toBeCloseTo(60 * 175 / 134);
    expect(bins[2].afterEstimatedWetKg).toBeCloseTo(60 * 175 / 134 + 175);
    // Derived fractions are not passed to the stored six-decimal input schema.
    const destinationInput = mocks.prepare.mock.calls[1][1];
    expect(destinationInput.moisturePercent).toBe(0);
    expect(outputStockPreviewSchema.safeParse({ ...destinationInput,
      facilityId: '00000000-0000-4000-8000-000000000001',
      storageLocationId: '00000000-0000-4000-8000-000000000002',
    }).success).toBe(true);
  });
  it('does not require a dry basis for zero-mass ingredient lines', async () => {
    mocks.composition.mockResolvedValue({ ingredients: [{ massKg: 0 }] });
    const bins = await previewProductStock(ctx, input);
    expect(bins).toHaveLength(2);
    expect(bins[1].afterSolidsKg).toBe(150);
    expect(bins[1].estimateMoisturePercent).toBe(25);
  });
  it('keeps wet stock usable without inventing a dry estimate when operator moisture is retained', async () => {
    mocks.stock.mockResolvedValue({ wetMassKg: 150, dryMassKg: null });
    const bins = await previewProductStock(ctx, input);
    expect(bins[1]).toMatchObject({ beforeDryKg: null, afterDryKg: null, removedDryKg: null, beforeEstimatedWetKg: 150, afterEstimatedWetKg: 105, blockingMessage: null });
    expect(bins[2].afterSolidsKg).toBe(194);
  });
  it('rejects an ingredient bin outside the active facility or organization', async () => {
    mocks.where.mockResolvedValue([]);
    await expect(previewProductStock(ctx, input)).rejects.toThrow('not found');
  });
});

const tx = { select: () => ({ from: () => ({ where: mocks.where }) }) } as unknown as import('@/db').DbTransaction;

async function repeatPrepared(inputOverride = input) {
  const source = await mocks.prepare.mock.results[0].value;
  const destination = await mocks.prepare.mock.results[1].value;
  mocks.prepare.mockResolvedValueOnce(source).mockResolvedValueOnce(destination);
  return prepareProductStock(ctx, inputOverride, tx);
}

describe('product-wide preview basis', () => {
  it('accepts unchanged stock, ignores UI metadata, and preserves the internal source fingerprint', async () => {
    const initial = await prepareProductStock(ctx, input, tx);
    const composition = await mocks.composition.mock.results[0].value;
    mocks.composition.mockResolvedValue({ ingredients: [...composition.ingredients].reverse().map((ingredient: Record<string, unknown>) => ({ ...ingredient, feedstockTypeName: 'Renamed UI label' })) });
    mocks.where.mockResolvedValue([{ id: 'ingredient', code: 'ING-RENAMED', name: 'New display label' }]);
    const unchanged = await repeatPrepared();
    expect(() => assertProductStockBasis(initial.basisFingerprint, unchanged)).not.toThrow();
    expect(unchanged.source.preview.basisFingerprint).toBe('source-basis');
  });
  it('rejects changed ingredient wet availability even with unchanged override solids', async () => {
    const initial = await prepareProductStock(ctx, input, tx);
    mocks.stock.mockResolvedValue({ wetMassKg: 140, dryMassKg: 130 });
    const changed = await repeatPrepared();
    expect(() => assertProductStockBasis(initial.basisFingerprint, changed)).toThrow('Stock changed');
  });
  it('rejects a changed derived ingredient basis with unchanged wet availability', async () => {
    const initial = await prepareProductStock(ctx, input, tx);
    mocks.composition.mockResolvedValue({ ingredients: [{ storageLocationId: 'ingredient', massKg: 30, massDryKg: 20 }] });
    const changed = await repeatPrepared();
    expect(() => assertProductStockBasis(initial.basisFingerprint, changed)).toThrow('Stock changed');
  });
  it('rejects destination stock events even when displayed balances are unchanged', async () => {
    const initial = await prepareProductStock(ctx, input, tx);
    const destination = await mocks.prepare.mock.results[1].value;
    destination.preview = { ...destination.preview, basisFingerprint: 'new-destination-event' };
    const changed = await repeatPrepared();
    expect(() => assertProductStockBasis(initial.basisFingerprint, changed)).toThrow('Stock changed');
  });
  it('rejects changed requested water and retains the typed refresh conflict', async () => {
    const initial = await prepareProductStock(ctx, input, tx);
    const changed = await repeatPrepared({ ...input, waterAddedKg: 21 });
    expect(() => assertProductStockBasis(initial.basisFingerprint, changed)).toThrow(expect.objectContaining({
      name: 'ActionConflictError', conflict: { entity: 'storageLocation', id: 'source', code: 'BC-1' },
    }));
  });
});

it('returns a typed refresh conflict if the ingredient basis is no longer available', async () => {
  const { SafeError } = await import('@/lib/errors');
  mocks.composition.mockRejectedValue(new SafeError('Ingredient stock not found.'));
  await expect(revalidateProductStock(ctx, input, tx, 'previous-product-basis')).rejects.toMatchObject({ name: 'ActionConflictError' });
});
