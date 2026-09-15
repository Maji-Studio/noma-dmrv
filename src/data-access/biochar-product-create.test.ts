import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionConflictError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  lockBins: vi.fn(), revalidate: vi.fn(), persist: vi.fn(), insert: vi.fn(), select: vi.fn(),
  sourceAllocations: vi.fn(), validate: vi.fn(), assertStock: vi.fn(), lockRequest: vi.fn(), findRequest: vi.fn(),
}));
vi.mock('@/db', () => ({ db: { transaction: async (run: (tx: unknown) => unknown) => run({ select: mocks.select, insert: mocks.insert }) } }));
vi.mock('./utils', () => ({ requireOrgScope: vi.fn() }));
vi.mock('./lock-bin-stocks', () => ({ lockBinStocks: mocks.lockBins }));
vi.mock('./product-stock-preview', () => ({ revalidateProductStock: mocks.revalidate }));
vi.mock('./biochar-product-composition', () => ({
  deriveCompositionSourceBiocharMassKg: () => 100,
  getCompositionIngredientDraws: () => [{ storageLocationId: 'ingredient', massKg: 20 }],
  validateCompositionIngredientBins: mocks.validate, assertCompositionIngredientDrawsWithinStock: mocks.assertStock,
}));
vi.mock('./biochar-product-source-allocations', () => ({ insertBiocharProductSourceAllocations: mocks.sourceAllocations }));
vi.mock('./output-stock-post', () => ({ lockOutputRequest: mocks.lockRequest, findOutputRequest: mocks.findRequest, persistOutputStock: mocks.persist }));
import { createBiocharProduct } from './biochar-product-create';

const ctx = { organizationId: 'org', userId: 'operator', orgRole: 'owner' as const, isPlatformAdmin: false };
const data = { code: 'BP-1', facilityId: 'facility', formulationId: 'recipe', placedAt: '2026-09-14',
  idempotencyKey: 'request', basisFingerprint: 'aggregate', sourceBiocharStorageLocationId: 'source', storageLocationId: 'destination',
  massKg: 120, moistureContentPercent: 10, waterAddedKg: 0, composition: { ingredients: [{ storageLocationId: 'ingredient', massKg: 20 }] } };

beforeEach(() => {
  vi.resetAllMocks();
  const rows = [[{ id: 'facility' }], [{ id: 'recipe', biocharRatio: 1 }], [{ id: 'destination', formulationId: 'recipe' }], [{ productionRunId: 'run', wetMassKg: '100' }]];
  mocks.select.mockImplementation(() => {
    const result = rows.shift();
    const query = { from: () => query, where: () => query, for: async () => result, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  });
  mocks.insert.mockReturnValue({ values: () => ({ returning: async () => [{ id: 'product' }] }) });
  mocks.revalidate.mockResolvedValue({ composition: { ingredients: [] }, source: {
    preview: { basisFingerprint: 'source-only', blockingMessage: null, allocations: [{ layerId: 'run', dryMassKg: 90 }] },
    plan: { allocations: [{ layerId: 'run' }] }, layers: [{ id: 'run', physicalDate: '2026-09-13' }],
  } });
  mocks.persist.mockResolvedValue({ movement: { id: 'movement' } });
});

describe('locked product preview revalidation', () => {
  it('recomputes under all affected bin locks and rejects stale basis before any writes', async () => {
    mocks.revalidate.mockRejectedValue(new ActionConflictError('Stock changed', { entity: 'storageLocation', id: 'ingredient', code: '' }));
    await expect(createBiocharProduct(ctx, data)).rejects.toMatchObject({ name: 'ActionConflictError' });
    expect(mocks.lockBins).toHaveBeenCalledWith(ctx, expect.anything(), ['destination', 'source', 'ingredient']);
    expect(mocks.lockBins.mock.invocationCallOrder[0]).toBeLessThan(mocks.revalidate.mock.invocationCallOrder[0]);
    expect(mocks.revalidate).toHaveBeenCalledWith(ctx, expect.objectContaining({ massKg: 100, ingredientBins: data.composition.ingredients }), expect.anything(), 'aggregate');
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it('passes only the source fingerprint to source stock posting after successful aggregate validation', async () => {
    await expect(createBiocharProduct(ctx, data)).resolves.toEqual({ id: 'product' });
    expect(mocks.revalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.insert.mock.invocationCallOrder[0]);
    expect(mocks.persist).toHaveBeenCalledWith(ctx, expect.anything(), expect.objectContaining({ basisFingerprint: 'source-only' }), expect.anything());
  });
});
