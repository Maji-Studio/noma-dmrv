import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { facilities } from '@/db/schema';
import { getBiocharOutputStockLayers, getOutputBinDryBalance, getOutputBinStockView, getProductOutputStockLayers } from './output-stock';
import { assertProductionRunBiocharStockNotOverdrawn, deriveProductionRunUpdateBiocharStockState } from './production-run-stock-locks';

const ctx: OrgContext = { organizationId: 'org', userId: 'user', orgRole: 'owner', isPlatformAdmin: false };
const input = { storageLocationId: 'bin', facilityId: 'facility', physicalDate: '2026-09-14' };
const bin = { id: 'bin', facilityId: 'facility', type: 'biochar_bin', archivedAt: null };
const run = { id: 'run', dryKg: '100.000', physicalDate: '2026-09-01', postingSequence: BigInt(1) };
function reader(results: unknown[][]) {
  const predicates: string[] = [];
  const executor = { select: vi.fn(() => {
    let result: unknown[] = [];
    const query = { from: (table: unknown) => { result = table === facilities ? [{ timezone: 'Africa/Dar_es_Salaam' }] : results.shift() ?? []; return query; }, innerJoin: () => query, leftJoin: () => query, orderBy: () => query,
      where: (predicate: SQL) => { if (!new PgDialect().sqlToQuery(predicate).sql.includes('"facilities"')) predicates.push(new PgDialect().sqlToQuery(predicate).sql); return query; },
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  }) } as unknown as DbTransaction;
  return { executor, predicates };
}

describe('output stock read and repair boundaries', () => {
  it.each(['biochar_bin', 'product_bin'])('hydrates archived %s only in explicit read mode', async type => {
    const read = reader([[{ ...bin, type, archivedAt: new Date() }], [bin], [], []]);
    expect(await getOutputBinStockView(ctx, bin.id, read.executor)).toMatchObject({ dryMassKg: 0 });
    expect(read.predicates[1]).not.toContain('"archived_at" is null');
    const posting = reader([[]]);
    const load = type === 'biochar_bin' ? getBiocharOutputStockLayers : getProductOutputStockLayers;
    await expect(load(ctx, input, posting.executor)).rejects.toThrow('archived');
    expect(posting.predicates[0]).toContain('"archived_at" is null');
    expect(posting.predicates[0]).toContain('"organization_id"');
    expect(posting.predicates[0]).toContain('"facility_id"');
  });
  it.each([null, 'NaN', 'Infinity'])('returns unavailable for an unresolved bin while an unrelated bin remains readable (%s)', async dryKg => {
    const unresolved = reader([[bin], [bin], [{ ...run, dryKg }], [], []]);
    const resolved = reader([[bin], [bin], [run], [], [], [{ id: run.id, wet: 125 }]]);
    expect(await Promise.all([getOutputBinStockView(ctx, 'bin', unresolved.executor), getOutputBinStockView(ctx, 'other', resolved.executor)]))
      .toEqual([{ dryMassKg: null, recordedWetMassKg: null, estimatedWetMassKg: null }, { dryMassKg: 100, recordedWetMassKg: 125, estimatedWetMassKg: 125 }]);
    await expect(getBiocharOutputStockLayers(ctx, input, reader([[bin], [{ ...run, dryKg: null }], [], []]).executor)).rejects.toThrow('unresolved');
  });
  it('excludes only the unresolved repair row, then validates its replacement', async () => {
    const tx = reader([[bin], [bin], [{ ...run, dryKg: null }], [], [], [bin], [bin], [run], [], []]).executor;
    const state = await deriveProductionRunUpdateBiocharStockState(ctx, tx, { id: run.id, biocharStorageLocationId: bin.id, biocharOutputKg: null, biocharDryMassKg: null, endTime: new Date() }, { biocharOutputKg: 125, biocharMoisturePercent: 20 });
    expect(state).toEqual([{ storageLocationId: bin.id, availableKg: 0 }]);
    await expect(assertProductionRunBiocharStockNotOverdrawn(ctx, tx, state)).resolves.toBeUndefined();
  });
  it('rejects excluding resolved stock, another unresolved row, or stock with saved downstream draws', async () => {
    const options = { excludeUnresolvedRunId: run.id };
    await expect(getBiocharOutputStockLayers(ctx, input, reader([[bin], [run], [], []]).executor, options)).rejects.toThrow('Only unresolved');
    await expect(getBiocharOutputStockLayers(ctx, input, reader([[bin], [{ ...run, id: 'other', dryKg: null }], [], []]).executor, options)).rejects.toThrow('unresolved');
    await expect(getBiocharOutputStockLayers(ctx, input, reader([[bin], [{ ...run, dryKg: null }], [{ runId: run.id }], []]).executor, options)).rejects.toThrow('downstream allocations');
  });
  it('does not read stock for unrelated metadata edits', async () => {
    const tx = reader([]).executor;
    expect(await deriveProductionRunUpdateBiocharStockState(ctx, tx, { id: run.id, biocharStorageLocationId: bin.id, biocharOutputKg: null, biocharDryMassKg: null, endTime: null }, {})).toEqual([]);
    expect(tx.select).not.toHaveBeenCalled();
  });
});


describe('product ingredient snapshot completeness', () => {
  const zeroLine = { formulationIngredientId: 'zero', massKg: 0 };
  const positiveLine = { formulationIngredientId: 'positive', massKg: 50 };
  const snapshot = { biocharProductId: 'product', formulationIngredientId: 'positive', drySolidsKg: '40.000' };
  function productReader(lines: unknown[], snapshots: unknown[]) {
    return reader([[bin], [{ id: 'product', placedAt: '2026-09-01', postingSequence: BigInt(1), composition: { ingredients: lines } }],
      [{ productId: 'product', runId: 'run', dryKg: '100.000' }], snapshots, []]).executor;
  }
  it('requires no snapshot for zero lines and sums only frozen positive solids', async () => {
    const zero = await getProductOutputStockLayers(ctx, input, productReader([zeroLine], []));
    expect(zero.layers[0].ingredientDrySolidsKg).toBe('0.000');
    const mixed = await getProductOutputStockLayers(ctx, input, productReader([zeroLine, positiveLine], [snapshot]));
    expect(mixed.layers[0]).toMatchObject({ ingredientDrySolidsKg: '40.000', establishedDryBiocharKg: '100.000' });
    expect(mixed.layers[0].remainingSolidsKg).toEqual({ numerator: BigInt(140), denominator: BigInt(1) });
  });
  it('rejects missing positive snapshots even when a zero-line snapshot fills the count', async () => {
    await expect(getProductOutputStockLayers(ctx, input, productReader([zeroLine, positiveLine], []))).rejects.toThrow('Ingredient dry solids are unresolved');
    await expect(getProductOutputStockLayers(ctx, input, productReader([zeroLine, positiveLine], [{ ...snapshot, formulationIngredientId: 'zero' }]))).rejects.toThrow('Ingredient dry solids are unresolved');
  });
});


describe('future stock conservation', () => {
  it.each(['biochar_bin', 'product_bin'])('keeps future %s stock in the guard balance but out of today previews', async type => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
    try {
      const rows = () => type === 'biochar_bin'
        ? [[{ ...bin, type }], [bin], [{ ...run, physicalDate: '2026-09-16' }], [], []]
        : [[{ ...bin, type }], [bin], [{ id: 'product', placedAt: '2026-09-16', postingSequence: BigInt(1), composition: {} }], [{ productId: 'product', runId: run.id, dryKg: '100.000' }], [], []];
      expect(await getOutputBinDryBalance(ctx, bin.id, reader(rows()).executor)).toBe(100);
      expect(await getOutputBinStockView(ctx, bin.id, reader([...rows(), []]).executor)).toEqual({ dryMassKg: 0, recordedWetMassKg: 0, estimatedWetMassKg: 0 });
    } finally { vi.useRealTimers(); }
  });
  it('shows the new facility day before UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T22:30:00Z'));
    try {
      const read = reader([[bin], [bin], [{ ...run, physicalDate: '2026-09-16' }], [], [], [{ id: run.id, wet: 125 }]]);
      expect(await getOutputBinStockView(ctx, bin.id, read.executor)).toEqual({ dryMassKg: 100, recordedWetMassKg: 125, estimatedWetMassKg: 125 });
    } finally { vi.useRealTimers(); }
  });
});
