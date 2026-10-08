import { expect, it, vi } from 'vitest';
import { conflictCode } from '@/lib/conflict-ref';
import { ActionConflictError } from '@/lib/errors';
import { rational } from '@/lib/output-stock';

const mocks = vi.hoisted(() => ({ reads: [] as unknown[], state: vi.fn(), stocks: vi.fn(), correction: vi.fn(), lineage: vi.fn() }));
vi.mock('@/db', () => {
  const tx = { select: () => {
    const query = { from: () => query, where: () => query, orderBy: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.reads.shift()).then(resolve) };
    return query;
  } };
  return { db: { ...tx, transaction: (run: (reader: unknown) => unknown) => run(tx) } };
});
vi.mock('./output-stock', () => ({ getBiocharOutputStockLayers: mocks.state, getProductOutputStockLayers: mocks.state, getOutputBinStocks: mocks.stocks, getLayerMoistureBases: async (_ctx: unknown, _bin: unknown, layers: { id: string; placedAt: string; remainingSolidsKg: unknown }[]) =>
  layers.map(layer => ({ layerId: layer.id, placedAt: layer.placedAt, remainingSolidsKg: layer.remainingSolidsKg, recorded: null, readings: [], removals: [] })) }));
vi.mock('./output-stock-corrections', () => ({ prepareOutputCorrection: mocks.correction }));
vi.mock('./certification-lineage-guards', () => ({ getCertifiedLineage: mocks.lineage }));
vi.mock('./output-stock-history', () => ({ getOutputStockHistory: vi.fn() }));
import { getMatchingOutputBins, prepareOutputStock, previewOutputStock } from './output-stock-operations';

it('keeps a correction fingerprint stable when product rows return in a different order', async () => {
  const binId = '00000000-0000-4000-8000-000000000001';
  const initialVersion = 1;
  const editedVersion = 2;
  const layers = ['earlier', 'later'].map((id, index) => ({
    id, placedAt: `2026-09-${index === 0 ? '12' : '13'}T12:00:00.000Z`,
    postingSequence: BigInt(index + 1), establishedDryBiocharKg: '100',
    ingredientDrySolidsKg: '0', remainingDryBiocharKg: '100',
    remainingSolidsKg: rational(BigInt(100)),
    runs: [{ productionRunId: id, establishedDryKg: '100', remainingDryKg: '100' }],
  }));
  const input = { storageLocationId: binId, facilityId: '00000000-0000-4000-8000-000000000002',
    correctsMovementId: '00000000-0000-4000-8000-000000000003', occurredAt: '2026-09-12T18:00:00.000Z',
    kind: 'count' as const, wetMassKg: 125, moisturePercent: 20 };
  const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
  const prepare = async (orderedLayers: typeof layers, version: number) => {
    mocks.reads = [[{ id: binId, type: 'product_bin', name: 'Products', code: 'PRODUCTS', formulationId: null }], [], [],
      layers.map(layer => ({ id: layer.id, code: layer.id, version: layer.id === 'later' ? version : initialVersion })), []];
    mocks.state.mockResolvedValue({ layers: orderedLayers });
    mocks.correction.mockResolvedValue({ original: { inputSnapshot: {} }, layers: orderedLayers, allocations: [], deliveryId: null });
    return prepareOutputStock(ctx, input);
  };
  const original = await prepare(layers, initialVersion);
  const refreshed = await prepare([...layers].reverse(), editedVersion);
  expect(original.preview.allocations).toEqual([]);
  expect(refreshed.readings.map(reading => reading.layerId)).toEqual(['earlier']);
  expect(refreshed.preview.expectedProductVersions?.later).toBe(editedVersion);
  expect(refreshed.preview.basisFingerprint).toBe(original.preview.basisFingerprint);

  const changedLayers = layers.map(layer => layer.id === 'later'
    ? { ...layer, placedAt: '2026-09-14T12:00:00.000Z' } : layer);
  expect((await prepare(changedLayers, editedVersion)).preview.basisFingerprint).not.toBe(original.preview.basisFingerprint);
});

it('returns certification artifact identities while checking both affected sources and the corrected delivery', async () => {
  const binId = '00000000-0000-4000-8000-000000000001';
  const layers = [{ id: 'run', placedAt: '2026-09-01T12:00:00.000Z', postingSequence: BigInt(1), establishedDryBiocharKg: '100', ingredientDrySolidsKg: '0', remainingDryBiocharKg: '100', remainingSolidsKg: rational(BigInt(100)), runs: [{ productionRunId: 'run', establishedDryKg: '100', remainingDryKg: '100' }] }];
  // Bin, its mode changes (none), its movements (none), then layer and run codes.
  mocks.reads = [[{ id: binId, type: 'biochar_bin', name: 'Source', code: 'BC-001', formulationId: null }], [], [], [{ id: 'run', code: 'RUN-001' }], [{ id: 'run', code: 'RUN-001' }]];
  mocks.state.mockResolvedValue({ layers });
  mocks.correction.mockResolvedValue({ original: { inputSnapshot: {} }, layers, allocations: [], deliveryId: 'delivery' });
  mocks.lineage.mockResolvedValueOnce([{ removalId: 'removal', removalSubmissionId: 'submitted', ghgStatementSubmissionId: null }]).mockResolvedValueOnce([{ removalId: 'removal', ghgStatementId: 'statement', ghgStatementSubmissionId: 'submitted' }]);
  const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
  const result = await previewOutputStock(ctx, { storageLocationId: binId, facilityId: '00000000-0000-4000-8000-000000000002', correctsMovementId: '00000000-0000-4000-8000-000000000003', occurredAt: '2026-09-14T12:00:00.000Z', kind: 'loss', wetMassKg: 10, moisturePercent: 10 });
  expect(result.blockingMessage).toContain('certification');
  expect(result.blockers).toEqual([{ entity: 'removal', id: 'removal', code: 'Removal' }, { entity: 'ghgStatement', id: 'statement', code: 'GHG Statement' }]);
  expect(mocks.lineage.mock.calls.map(call => call[2])).toEqual([{ entityType: 'productionRun', entityId: 'run' }, { entityType: 'delivery', entityId: 'delivery' }]);
  expect(result.removedDryKg).toBe(9);
});


it('passes the blocking movement through when a correction is refused', async () => {
  const binId = '00000000-0000-4000-8000-000000000001';
  const layers = [{ id: 'run', placedAt: '2026-09-01T12:00:00.000Z', postingSequence: BigInt(1), establishedDryBiocharKg: '100', ingredientDrySolidsKg: '0', remainingDryBiocharKg: '100', remainingSolidsKg: rational(BigInt(100)), runs: [{ productionRunId: 'run', establishedDryKg: '100', remainingDryKg: '100' }] }];
  const bin = { id: binId, type: 'biochar_bin', name: 'Source', code: 'BC-001', formulationId: null };
  // The refused pass reads only the bin before the correction throws; the
  // fallback pass then reads the bin, its events and both code lists.
  const runCodes = [{ id: 'run', code: 'RUN-001' }];
  // The refused correction reads only the bin; the balance fallback then reads the bin, its mode changes, movements and codes.
  mocks.reads = [[bin], [bin], [], [], runCodes, runCodes];
  mocks.state.mockResolvedValue({ layers });
  const movement = { entity: 'binMovement', id: 'later', code: conflictCode('Later loss (2026-09-12)') };
  mocks.correction.mockRejectedValue(new ActionConflictError('Correction blocked by a later loss.', { entity: 'storageLocation', id: binId, code: conflictCode('BC-001') }, { blockers: [movement] }));
  const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
  const result = await previewOutputStock(ctx, { storageLocationId: binId, facilityId: '00000000-0000-4000-8000-000000000002', correctsMovementId: '00000000-0000-4000-8000-000000000003', occurredAt: '2026-09-14T12:00:00.000Z', kind: 'loss', wetMassKg: 10, moisturePercent: 10 });
  expect(result.blockingMessage).toContain('Correction blocked by a later loss.');
  expect(result.blockers).toEqual([movement]);
});

it('reads every matching bin in one stock batch and keeps an unresolved bin in the list', async () => {
  mocks.reads = [[{ id: 'recipe' }], [{ id: 'bin', code: 'BIN', name: 'E2E bin' }, { id: 'broken', code: 'BIN-2', name: 'Unresolved bin' }]];
  mocks.state.mockClear();
  mocks.stocks.mockResolvedValue(new Map([
    ['bin', { allLayersDryKg: 100, availableDryKg: 100, estimatedWetMassKg: 118, estimatedMoisturePercent: 15.3 }],
    ['broken', { allLayersDryKg: null, availableDryKg: null, estimatedWetMassKg: null, estimatedMoisturePercent: null }],
  ]));
  const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
  expect(await getMatchingOutputBins(ctx, { facilityId: 'facility', formulationId: 'recipe' })).toEqual([
    { id: 'bin', code: 'BIN', name: 'E2E bin', dryMassKg: 100, estimatedWetMassKg: 118 },
    { id: 'broken', code: 'BIN-2', name: 'Unresolved bin', dryMassKg: null, estimatedWetMassKg: null },
  ]);
  // The stock batch owns the current instant; the list no longer computes layers itself.
  expect(mocks.stocks).toHaveBeenCalledTimes(1);
  expect(mocks.stocks.mock.calls[0][1]).toEqual(['bin', 'broken']);
  expect(mocks.state).not.toHaveBeenCalled();
});
