import { buildRunSankey, EXIT_EPSILON_KG } from '@/lib/chain-of-custody/sankey';
import type { RunMaterialBalanceInput } from '@/lib/production-run-returns/material-balance';
import type { WaterfallItem, WaterfallRecord } from './waterfall-model';

interface RunReturnDetail {
  movementId: string;
  storageLocationId: string;
  destinationCode: string | null;
  destinationName: string | null;
  wetMassKg: number;
  dryMassKg: number;
  moistureRatio: number;
  occurredAt: Date;
}

/** Dry-first run view. Returned water is never described as driven off. */
export function buildRunWaterfall(input: RunMaterialBalanceInput, code: string, returns: readonly RunReturnDetail[] = []) {
  const sankey = buildRunSankey(input);
  let level = input.consumedDryKg;
  const record = { id: input.runId, kind: 'productionRun' as const, code, name: null };
  const items: (Omit<WaterfallItem, 'key' | 'records' | 'recordKind'> & {
    key: WaterfallItem['key'] | 'usable_output';
    recordKind: WaterfallItem['recordKind'] | 'storageLocation';
    records: (Omit<WaterfallRecord, 'kind'> & { kind: WaterfallRecord['kind'] | 'storageLocation' })[];
  })[] = [{
    key: 'feedstock', kind: 'start', label: 'Consumed feedstock', massKg: level, top: level, bottom: 0,
    basis: 'dry', stage: null, recordKind: 'productionRun', records: [{ ...record, massKg: level }],
    note: 'Consumed dry feedstock, based on measured draws and run moisture.',
  }];
  for (const exit of sankey.exits) {
    const records = exit.key === 'dumped_back'
      ? returns.map(row => ({ id: row.storageLocationId, kind: 'storageLocation' as const,
        code: row.destinationCode ?? '', name: row.destinationName, massKg: row.dryMassKg, wetKg: row.wetMassKg }))
      : [{ ...record, massKg: exit.massKg }];
    items.push({ key: exit.key, kind: 'step', label: exit.label, massKg: exit.massKg, top: level, bottom: level - exit.massKg,
      basis: 'dry', stage: 'productionRuns', recordKind: exit.key === 'dumped_back' ? 'storageLocation' : 'productionRun', records,
      note: exit.key === 'dumped_back'
        ? 'Dry material returned at the run boundary. Wet measurements and destinations are recorded separately. Later storage losses do not change this amount.'
        : 'Consumed dry mass less usable output and material returned to storage.',
    });
    level -= exit.massKg;
  }
  items.push({ key: 'usable_output', kind: 'end', label: 'Usable output', massKg: input.usableOutputDryKg,
    top: input.usableOutputDryKg, bottom: 0, basis: 'dry', stage: null, recordKind: 'productionRun',
    records: [{ ...record, massKg: input.usableOutputDryKg }], note: 'Failed runs have no usable output.' });
  const rawClosing = input.consumedDryKg - sankey.exits.reduce((sum, exit) => sum + exit.rawKg, 0) - sankey.omittedResidualKg;
  const balanced = Math.abs(rawClosing - input.usableOutputDryKg) <= EXIT_EPSILON_KG && sankey.warnings.length === 0;
  if (!balanced) for (const item of items) if (item.kind === 'step') { item.top = item.massKg; item.bottom = 0; }
  return { items, startBasis: 'dry' as const, startKg: input.consumedDryKg, endKg: input.usableOutputDryKg,
    balanced, warnings: sankey.warnings, omittedResidualKg: sankey.omittedResidualKg, returns };
}
