import { beforeEach, describe, expect, it, vi } from 'vitest';
import { outputStockPreviewSchema } from '@/schemas/output-stock';
import type { OutputStockPreview } from '@/types/output-stock';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), composition: vi.fn(), stock: vi.fn(), scope: vi.fn(), where: vi.fn() }));
vi.mock('@/db', () => ({ db: { transaction: async (run: (tx: unknown) => unknown) => run({ select: () => ({ from: () => ({ where: mocks.where }) }) }) } }));
vi.mock('./utils', () => ({ requireOrgScope: mocks.scope }));
vi.mock('./output-stock-operations', () => ({ prepareOutputStock: mocks.prepare }));
vi.mock('./biochar-product-composition', () => ({ resolveCompositionIngredientMassBasis: mocks.composition }));
vi.mock('./lane-stock-derivation', () => ({ deriveLaneStock: mocks.stock }));
import { previewProductStock, type ProductStockPreviewInput } from './product-stock-preview';

const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
const input: ProductStockPreviewInput = { facilityId: 'facility', formulationId: 'recipe', placedAt: '2026-09-14', sourceBiocharStorageLocationId: 'source', storageLocationId: 'destination', massKg: 100, moistureContentPercent: 10, waterAddedKg: 20, ingredientBins: [] };
const preview: OutputStockPreview = { storageLocationId: 'source', binName: 'Source', binCode: 'BC-1', lane: 'biochar', basisFingerprint: 'source-basis', beforeDryKg: 180, afterDryKg: 90, beforeSolidsKg: 180, afterSolidsKg: 90, removedDryKg: 90, removedWetKg: 100, estimateMoisturePercent: 10, beforeEstimatedWetKg: 200, afterEstimatedWetKg: 100, discrepancySolidsKg: 0, blockingMessage: null, allocations: [{ layerId: 'run', code: 'RUN-1', wetMassKg: 100, dryMassKg: 90, runs: [{ productionRunId: 'run', code: 'RUN-1', dryMassKg: 90 }] }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockReset().mockResolvedValueOnce({ preview, lane: 'biochar' }).mockResolvedValueOnce({ preview: { ...preview, storageLocationId: 'destination', lane: 'product', beforeDryKg: 50, beforeSolidsKg: 60, beforeEstimatedWetKg: 60, beforeAllocations: [{ layerId: 'existing', code: 'Existing', dryMassKg: 50, wetMassKg: 60, runs: [] }] }, lane: 'product', bin: { formulationId: 'recipe' } });
  mocks.composition.mockResolvedValue({ ingredients: [{ storageLocationId: 'ingredient', massKg: 30, massDryKg: 24 }, { storageLocationId: 'ingredient', massKg: 15, massDryKg: 12 }, { storageLocationId: null, massKg: 10, massDryKg: 8 }] });
  mocks.where.mockResolvedValue([{ id: 'ingredient', code: 'ING-1', name: 'Compost' }]);
  mocks.stock.mockResolvedValue([{ feedstockStockWetKg: 150, feedstockEstimatedDryKg: 140 }]);
});

describe('product stock preview', () => {
  it('groups tracked ingredient draws by physical bin and includes the receiving stock', async () => {
    const bins = await previewProductStock(ctx, input);
    expect(mocks.scope).toHaveBeenCalledWith(ctx);
    expect(bins.map(bin => bin.storageLocationId)).toEqual(['source', 'ingredient', 'destination']);
    expect(bins[0]).toEqual(preview);
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
  it('does not fabricate ingredient dry solids when the stock basis is unavailable', async () => {
    mocks.stock.mockResolvedValue([{ feedstockStockWetKg: 150, feedstockEstimatedDryKg: null }]);
    await expect(previewProductStock(ctx, input)).rejects.toThrow('complete moisture basis');
  });
  it('rejects an ingredient bin outside the active facility or organization', async () => {
    mocks.where.mockResolvedValue([]);
    await expect(previewProductStock(ctx, input)).rejects.toThrow('not found');
  });
});
