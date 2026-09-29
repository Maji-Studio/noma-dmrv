import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { biocharProducts, biocharProductSourceAllocations, facilities, outputStockAllocations, productionRuns, storageLocations } from '@/db/schema';
import { getBiocharOutputStockLayers, getOutputBinStocks, getOutputBinStockView, getProductOutputStockLayers } from './output-stock';
import { assertProductionRunBiocharStockNotOverdrawn, deriveProductionRunUpdateBiocharStockState } from './production-run-stock-locks';

// Layer rules are tested with plain rows in lib/output-stock/layer-projection.test.ts.
// These cases pin what only the readers own: scope predicates, batching and wiring.

const ctx: OrgContext = { organizationId: 'org', userId: 'user', orgRole: 'owner', isPlatformAdmin: false };
const input = { storageLocationId: 'bin', facilityId: 'facility', occurredAt: '2026-09-14T12:00:00.000Z' };
const bin = { id: 'bin', facilityId: 'facility', type: 'biochar_bin', archivedAt: null };
const run = { id: 'run', binId: 'bin', facilityId: 'facility', archivedAt: null, dryKg: '100.000', endTime: new Date('2026-09-01T12:00:00.000Z'), postingSequence: BigInt(1) };

/**
 * A reader that answers each table from its own queue, so the tests do not
 * depend on the order concurrent queries start in. Records every predicate.
 */
function reader(queues: ReadonlyArray<readonly [unknown, readonly unknown[][]]>) {
  const pending = new Map(queues.map(([table, results]) => [table, [...results]]));
  const predicates: { table: unknown; sql: string }[] = [];
  const executor = { select: vi.fn(() => {
    let table: unknown;
    const query = { from: (from: unknown) => { table = from; return query; }, innerJoin: () => query, leftJoin: () => query, orderBy: () => query,
      where: (predicate: SQL) => { predicates.push({ table, sql: new PgDialect().sqlToQuery(predicate).sql }); return query; },
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(table === facilities ? [{ timezone: 'Africa/Dar_es_Salaam' }] : pending.get(table)?.shift() ?? []).then(resolve) };
    return query;
  }) } as unknown as DbTransaction;
  return { executor, predicates, sqlFor: (table: unknown) => predicates.filter(p => p.table === table).map(p => p.sql) };
}

describe('posting readers', () => {
  it.each([['biochar_bin', getBiocharOutputStockLayers], ['product_bin', getProductOutputStockLayers]] as const)('scope a %s to the organization, facility and live bins', async (_type, load) => {
    const posting = reader([]);
    await expect(load(ctx, input, posting.executor)).rejects.toThrow('archived');
    const [binPredicate] = posting.sqlFor(storageLocations);
    expect(binPredicate).toContain('"archived_at" is null');
    expect(binPredicate).toContain('"organization_id"');
    expect(binPredicate).toContain('"facility_id"');
  });

  it('keeps an archived run out of a live read and in an explicit archived read', async () => {
    const rows = () => reader([[storageLocations, [[bin]]], [productionRuns, [[run, { ...run, id: 'archived', archivedAt: new Date(), postingSequence: BigInt(2) }]]]]);
    expect((await getBiocharOutputStockLayers(ctx, input, rows().executor)).layers.map(l => l.id)).toEqual(['run']);
    expect((await getBiocharOutputStockLayers(ctx, input, rows().executor, { includeArchived: true })).layers.map(l => l.id)).toEqual(['run', 'archived']);
  });

  it('keeps a run recorded at another facility out of the bin', async () => {
    const read = reader([[storageLocations, [[bin]]], [productionRuns, [[run, { ...run, id: 'elsewhere', facilityId: 'other', postingSequence: BigInt(2) }]]]]);
    expect((await getBiocharOutputStockLayers(ctx, input, read.executor)).layers.map(l => l.id)).toEqual(['run']);
  });
});

describe('batched stock read', () => {
  const productBin = { id: 'products', facilityId: 'facility', type: 'product_bin', archivedAt: null };

  it('reads any number of bins with one query per table', async () => {
    const bins = Array.from({ length: 5 }, (_, i) => ({ ...bin, id: `bin-${i}` }));
    const read = reader([[storageLocations, [[...bins, productBin]]]]);
    await getOutputBinStocks(ctx, [...bins.map(b => b.id), productBin.id], read.executor);
    for (const table of [storageLocations, productionRuns, biocharProductSourceAllocations, biocharProducts, outputStockAllocations]) {
      expect(read.sqlFor(table).length).toBeLessThanOrEqual(2);
    }
    for (const { sql } of read.predicates) expect(sql).toContain('"organization_id"');
  });

  it.each([null, 'NaN', 'Infinity'])('reads an unresolved bin as unavailable while another bin stays readable (%s)', async dryKg => {
    const other = { ...bin, id: 'other' };
    const read = reader([[storageLocations, [[bin, other]]], [productionRuns, [[{ ...run, dryKg }, { ...run, id: 'other-run', binId: 'other' }], [{ id: 'other-run', wet: '125.000' }]]]]);
    const stocks = await getOutputBinStocks(ctx, ['bin', 'other'], read.executor);
    expect(stocks.get('bin')).toEqual({ allLayersDryKg: null, availableDryKg: null, estimatedWetMassKg: null, estimatedMoisturePercent: null });
    expect(stocks.get('other')).toEqual({ allLayersDryKg: 100, availableDryKg: 100, estimatedWetMassKg: 125, estimatedMoisturePercent: 20 });
  });

  it('includes an archived bin\'s archived layers', async () => {
    const archived = { ...bin, archivedAt: new Date() };
    const read = reader([[storageLocations, [[archived]]], [productionRuns, [[{ ...run, archivedAt: new Date() }]]]]);
    expect(await getOutputBinStockView(ctx, 'bin', read.executor)).toMatchObject({ dryMassKg: 100 });
  });

  it('skips the query when there is nothing to read', async () => {
    const read = reader([]);
    expect(await getOutputBinStocks(ctx, [], read.executor)).toEqual(new Map());
    expect(read.executor.select).not.toHaveBeenCalled();
  });

  it.each([['2026-09-15T22:29:00.000Z', 100], ['2026-09-15T22:31:00.000Z', 0]] as const)('reads availability as of now, and keeps later receipts in the all-layers balance (run ended %s)', async (endTime, availableDryKg) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T22:30:00Z'));
    try {
      const read = reader([[storageLocations, [[bin]]], [productionRuns, [[{ ...run, endTime: new Date(endTime) }]]]]);
      expect((await getOutputBinStocks(ctx, ['bin'], read.executor)).get('bin')).toMatchObject({ availableDryKg, allLayersDryKg: 100 });
    } finally { vi.useRealTimers(); }
  });
});

describe('production run repair', () => {
  it('excludes only the unresolved repair row, then validates its replacement', async () => {
    const tx = reader([[storageLocations, [[bin], [bin], [bin], [bin]]], [productionRuns, [[{ ...run, dryKg: null }], [run]]]]).executor;
    const state = await deriveProductionRunUpdateBiocharStockState(ctx, tx, { id: run.id, biocharStorageLocationId: bin.id, biocharOutputKg: null, biocharDryMassKg: null, endTime: new Date() }, { biocharOutputKg: 125, biocharMoisturePercent: 20 });
    expect(state).toEqual([{ storageLocationId: bin.id, availableKg: 0 }]);
    await expect(assertProductionRunBiocharStockNotOverdrawn(ctx, tx, state)).resolves.toBeUndefined();
  });

  it('does not read stock for unrelated metadata edits', async () => {
    const tx = reader([]).executor;
    expect(await deriveProductionRunUpdateBiocharStockState(ctx, tx, { id: run.id, biocharStorageLocationId: bin.id, biocharOutputKg: null, biocharDryMassKg: null, endTime: null }, {})).toEqual([]);
    expect(tx.select).not.toHaveBeenCalled();
  });
});
