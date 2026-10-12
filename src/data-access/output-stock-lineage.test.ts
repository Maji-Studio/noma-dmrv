import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import { SafeError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({ assert: vi.fn(), readings: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./certification-lineage-guards', () => ({ assertCanMutateCertifiedLineage: mocks.assert }));
import { assertOutputLayersMutable, changedOutputLayerIds, type PlannedOutputChange } from './output-stock-lineage';

const ctx = { organizationId: 'org', userId: 'operator', orgRole: 'owner' as const, isPlatformAdmin: false };
const tx = { select: () => ({ from: () => ({ where: mocks.readings }) }) } as unknown as DbTransaction;
const layers = ['oldest', 'middle', 'newest'].map(id => ({ id }));
const change = (overrides: Partial<PlannedOutputChange>): PlannedOutputChange => ({ lane: 'biochar', layers, plan: { allocations: [] }, readings: [], correction: null, ...overrides });

beforeEach(() => vi.resetAllMocks());

describe('layers a posting changes (decision 51)', () => {
  it('includes layers a count only reads, in bin order', async () => {
    const ids = await changedOutputLayerIds(ctx, tx, change({ plan: { allocations: [{ layerId: 'oldest' }] }, readings: [{ layerId: 'newest' }, { layerId: 'middle' }] }));
    expect(ids).toEqual(['oldest', 'middle', 'newest']);
    expect(mocks.readings).not.toHaveBeenCalled();
  });

  it('includes a zero-draw count that only resets readings', async () => {
    expect(await changedOutputLayerIds(ctx, tx, change({ readings: [{ layerId: 'middle' }] }))).toEqual(['middle']);
  });

  it('includes restored layers and the layers whose original readings a correction removes', async () => {
    mocks.readings.mockResolvedValue([{ biocharProductId: null, productionRunId: 'newest' }, { biocharProductId: null, productionRunId: 'emptied' }]);
    const ids = await changedOutputLayerIds(ctx, tx, change({
      plan: { allocations: [{ layerId: 'middle' }] },
      correction: { original: { id: 'count' }, allocations: [{ biocharProductId: null, productionRunId: 'oldest' }] },
    }));
    // A layer the bin no longer lists still counts, after the listed ones.
    expect(ids).toEqual(['oldest', 'middle', 'newest', 'emptied']);
  });

  it('reads product readings on a product bin', async () => {
    mocks.readings.mockResolvedValue([{ biocharProductId: 'middle', productionRunId: null }]);
    expect(await changedOutputLayerIds(ctx, tx, change({ lane: 'product', correction: { original: { id: 'count' }, allocations: [] } }))).toEqual(['middle']);
  });
});

describe('certified layers', () => {
  it('refuses a locked layer as certification_locked with the guard message', async () => {
    mocks.assert.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new SafeError('Production run is locked by a certification submission.'));
    await expect(assertOutputLayersMutable(ctx, tx, 'biochar', ['oldest', 'newest'])).rejects.toMatchObject({
      code: 'certification_locked', message: 'Production run is locked by a certification submission.',
    });
    expect(mocks.assert.mock.calls.map(call => call[2])).toEqual([{ entityType: 'productionRun', entityId: 'oldest' }, { entityType: 'productionRun', entityId: 'newest' }]);
  });

  it('checks product layers as products', async () => {
    await assertOutputLayersMutable(ctx, tx, 'product', ['middle']);
    expect(mocks.assert).toHaveBeenCalledWith(ctx, tx, { entityType: 'biocharProduct', entityId: 'middle' }, 'update');
  });
});
