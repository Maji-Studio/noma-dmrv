import { expect, it, vi } from 'vitest';
import { rational } from '@/lib/output-stock';

const mocks = vi.hoisted(() => ({ reads: [] as unknown[], state: vi.fn(), correction: vi.fn(), lineage: vi.fn() }));
vi.mock('@/db', () => {
  const tx = { select: () => {
    const query = { from: () => query, where: () => query, orderBy: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.reads.shift()).then(resolve) };
    return query;
  } };
  return { db: { ...tx, transaction: (run: (reader: unknown) => unknown) => run(tx) } };
});
vi.mock('./output-stock', () => ({ getBiocharOutputStockLayers: mocks.state, getProductOutputStockLayers: mocks.state }));
vi.mock('./output-stock-corrections', () => ({ prepareOutputCorrection: mocks.correction }));
vi.mock('./certification-lineage-guards', () => ({ getCertifiedLineage: mocks.lineage }));
vi.mock('./output-stock-history', () => ({ getOutputStockHistory: vi.fn() }));
import { previewOutputStock } from './output-stock-operations';

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
