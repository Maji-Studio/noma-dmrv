import { expect, it, vi } from 'vitest';
import { conflictCode } from '@/lib/conflict-ref';
import { ActionConflictError } from '@/lib/errors';
import { rational } from '@/lib/output-stock';

const mocks = vi.hoisted(() => ({ reads: [] as unknown[], state: vi.fn(), view: vi.fn(), correction: vi.fn(), lineage: vi.fn() }));
vi.mock('@/db', () => {
  const tx = { select: () => {
    const query = { from: () => query, where: () => query, orderBy: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.reads.shift()).then(resolve) };
    return query;
  } };
  return { db: { ...tx, transaction: (run: (reader: unknown) => unknown) => run(tx) } };
});
vi.mock('./output-stock', () => ({ getBiocharOutputStockLayers: mocks.state, getProductOutputStockLayers: mocks.state, getOutputBinStockView: mocks.view }));
vi.mock('./output-stock-corrections', () => ({ prepareOutputCorrection: mocks.correction }));
vi.mock('./certification-lineage-guards', () => ({ getCertifiedLineage: mocks.lineage }));
vi.mock('./output-stock-history', () => ({ getOutputStockHistory: vi.fn() }));
import { getMatchingOutputBins, previewOutputStock } from './output-stock-operations';

it('returns certification artifact identities while checking both affected sources and the corrected delivery', async () => {
  const binId = '00000000-0000-4000-8000-000000000001';
  const layers = [{ id: 'run', physicalDate: '2026-09-01', postingSequence: BigInt(1), establishedDryBiocharKg: '100', ingredientDrySolidsKg: '0', remainingDryBiocharKg: '100', remainingSolidsKg: rational(BigInt(100)), runs: [{ productionRunId: 'run', establishedDryKg: '100', remainingDryKg: '100' }] }];
  mocks.reads = [[{ id: binId, type: 'biochar_bin', name: 'Source', code: 'BC-001', formulationId: null }], [], [{ id: 'run', code: 'RUN-001' }], [{ id: 'run', code: 'RUN-001' }]];
  mocks.state.mockResolvedValue({ layers });
  mocks.correction.mockResolvedValue({ layers, allocations: [], deliveryId: 'delivery' });
  mocks.lineage.mockResolvedValueOnce([{ removalId: 'removal', removalSubmissionId: 'submitted', ghgStatementSubmissionId: null }]).mockResolvedValueOnce([{ removalId: 'removal', ghgStatementId: 'statement', ghgStatementSubmissionId: 'submitted' }]);
  const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
  const result = await previewOutputStock(ctx, { storageLocationId: binId, facilityId: '00000000-0000-4000-8000-000000000002', correctsMovementId: '00000000-0000-4000-8000-000000000003', physicalDate: '2026-09-14', kind: 'loss', wetMassKg: 10, moisturePercent: 10 });
  expect(result.blockingMessage).toContain('certification');
  expect(result.blockers).toEqual([{ entity: 'removal', id: 'removal', code: 'Removal' }, { entity: 'ghgStatement', id: 'statement', code: 'GHG Statement' }]);
  expect(mocks.lineage.mock.calls.map(call => call[2])).toEqual([{ entityType: 'productionRun', entityId: 'run' }, { entityType: 'delivery', entityId: 'delivery' }]);
  expect(result.removedDryKg).toBe(9);
});


it('passes the blocking movement through when a correction is refused', async () => {
  const binId = '00000000-0000-4000-8000-000000000001';
  const layers = [{ id: 'run', physicalDate: '2026-09-01', postingSequence: BigInt(1), establishedDryBiocharKg: '100', ingredientDrySolidsKg: '0', remainingDryBiocharKg: '100', remainingSolidsKg: rational(BigInt(100)), runs: [{ productionRunId: 'run', establishedDryKg: '100', remainingDryKg: '100' }] }];
  const bin = { id: binId, type: 'biochar_bin', name: 'Source', code: 'BC-001', formulationId: null };
  // The refused pass reads only the bin before the correction throws; the
  // fallback pass then reads the bin, its events and both code lists.
  const runCodes = [{ id: 'run', code: 'RUN-001' }];
  mocks.reads = [[bin], [bin], [], runCodes, runCodes];
  mocks.state.mockResolvedValue({ layers });
  const movement = { entity: 'binMovement', id: 'later', code: conflictCode('Later loss (2026-09-12)') };
  mocks.correction.mockRejectedValue(new ActionConflictError('Correction blocked by a later loss.', { entity: 'storageLocation', id: binId, code: conflictCode('BC-001') }, { blockers: [movement] }));
  const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
  const result = await previewOutputStock(ctx, { storageLocationId: binId, facilityId: '00000000-0000-4000-8000-000000000002', correctsMovementId: '00000000-0000-4000-8000-000000000003', physicalDate: '2026-09-14', kind: 'loss', wetMassKg: 10, moisturePercent: 10 });
  expect(result.blockingMessage).toContain('Correction blocked by a later loss.');
  expect(result.blockers).toEqual([movement]);
});

it('reads each matching bin from its stock view and keeps an unresolved bin in the list', async () => {
  mocks.reads = [[{ id: 'recipe' }], [{ id: 'bin', code: 'BIN', name: 'E2E bin' }, { id: 'broken', code: 'BIN-2', name: 'Unresolved bin' }]];
  mocks.state.mockClear();
  mocks.view.mockImplementation(async (_ctx: unknown, id: string) => id === 'bin'
    ? { dryMassKg: 100, recordedWetMassKg: 130, estimatedWetMassKg: 118 }
    : { dryMassKg: null, recordedWetMassKg: null, estimatedWetMassKg: null });
  const ctx = { userId: 'operator', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: false };
  expect(await getMatchingOutputBins(ctx, { facilityId: 'facility', formulationId: 'recipe' })).toEqual([
    { id: 'bin', code: 'BIN', name: 'E2E bin', dryMassKg: 100, recordedWetMassKg: null, estimatedWetMassKg: 118 },
    { id: 'broken', code: 'BIN-2', name: 'Unresolved bin', dryMassKg: null, recordedWetMassKg: null, estimatedWetMassKg: null },
  ]);
  // The stock view owns the facility-local date; the list no longer computes layers itself.
  expect(mocks.state).not.toHaveBeenCalled();
});
