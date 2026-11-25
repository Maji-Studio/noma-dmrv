import { describe, expect, it } from 'vitest';
import { calculateRunMaterialBalance } from './material-balance';
import { buildBatchSankey, buildRunSankey } from '@/lib/chain-of-custody/sankey';
import { buildRunWaterfall } from '@/components/chain-of-custody/sankey/run-waterfall-model';

const input = { runId: 'failed-run', consumedDryKg: 80, usableOutputDryKg: 0, activeReturnedDryKg: 0 };

describe('run boundary dry material balance', () => {
  it.each([[0, 80], [30, 50], [80, 0]])('accounts for %s returned dry kg with %s conversion loss', (returned, loss) => {
    const result = buildRunSankey({ ...input, activeReturnedDryKg: returned });
    expect(result.balance.conversionLossDryKg).toBe(loss);
    expect(result.exits.reduce((sum, exit) => sum + exit.rawKg, 0)).toBe(80);
    expect(result.exits.find(exit => exit.key === 'dumped_back')).toEqual(returned ? {
      key: 'dumped_back', label: 'Returned to storage', fromColumn: 'productionRuns', massKg: returned, rawKg: returned, tone: 'loss',
    } : undefined);
    expect(result.exits.some(exit => exit.key === 'in_storage')).toBe(false);
  });

  it('subtracts usable output and returned solids exactly once', () => {
    expect(calculateRunMaterialBalance({ ...input, usableOutputDryKg: 20, activeReturnedDryKg: 30 }).conversionLossDryKg).toBe(30);
  });

  it('preserves raw residuals when displayed exits round away', () => {
    const result = buildRunSankey({ ...input, consumedDryKg: 80.003, activeReturnedDryKg: 80 });
    expect(result.exits.map(exit => exit.key)).toEqual(['dumped_back']);
    expect(result.omittedResidualKg).toBeCloseTo(0.003);
    expect(result.exits.reduce((sum, exit) => sum + exit.rawKg, result.omittedResidualKg)).toBe(80.003);
  });

  it('closes displayed levels instead of rounding each exit independently', () => {
    const result = buildRunSankey({ ...input, consumedDryKg: 80.04, usableOutputDryKg: 10.04, activeReturnedDryKg: 30.04 });
    expect(result.exits.reduce((sum, exit) => sum + exit.massKg, 0)).toBe(70);
    expect(result.warnings).toEqual([]);
  });

  it('reports inconsistent raw measurements', () => {
    const result = buildRunSankey({ ...input, activeReturnedDryKg: 81 });
    expect(result.warnings).toHaveLength(1);
    expect(result.exits.some(exit => exit.key === 'conversion_loss')).toBe(false);
  });

  it('keeps failed-run water out of the waterfall and retains destination measurements', () => {
    const detail = { movementId: 'return', storageLocationId: 'bin', destinationCode: 'BIN-1', destinationName: 'Returned material',
      wetMassKg: 100, dryMassKg: 50, moistureRatio: 0.5, occurredAt: new Date('2026-01-02T12:00:00Z') };
    const model = buildRunWaterfall({ ...input, activeReturnedDryKg: 50 }, 'PR-1', [detail]);
    expect(model.startBasis).toBe('dry');
    expect(model.items.map(item => item.key)).toEqual(['feedstock', 'conversion_loss', 'dumped_back', 'usable_output']);
    expect(model.items.find(item => item.key === 'dumped_back')?.records).toEqual([
      { id: 'bin', kind: 'storageLocation', code: 'BIN-1', name: 'Returned material', massKg: 50, wetKg: 100 },
    ]);
    expect(model.returns).toEqual([detail]);
    expect(model.balanced).toBe(true);
  });

  it('does not add failed runs or return mass to batch membership, totals or emissions', () => {
    const lineage = { application: { id: 'app', biocharAppliedDryTons: 0.01 },
      productionRun: { id: 'successful-run', feedstockMassDryKg: 100, biocharDryMassKg: 20 },
      biocharProduct: { id: 'product', massKg: 20, moistureContentPercent: 0 }, feedstocks: [] };
    const before = buildBatchSankey([lineage]);
    buildRunSankey({ ...input, activeReturnedDryKg: 80 });
    expect(buildBatchSankey([lineage])).toEqual(before);
    expect(before.facts.runs.map(run => run.id)).toEqual(['successful-run']);
    expect(before.columns.map(column => column.massKg)).toEqual([100, 20, 20, 10]);
    expect(before).not.toHaveProperty('emissions');
  });
});
