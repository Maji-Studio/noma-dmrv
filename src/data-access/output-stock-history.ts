import { db } from '@/db';
import { binMovements, biocharProducts, biocharProductSourceAllocations, productionRuns, productIngredientSnapshots, storageLocations, users } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { orderedSourcesSchema } from '@/schemas/output-stock';
import type { OutputMoistureReset, OutputStockHistoryEntry, OutputStockPreview } from '@/types/output-stock';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getOutputStockAllocationProjection } from './output-stock';
import { requireOrgScope } from './utils';
import { stockEntryLockReason } from '@/lib/output-stock/edit-lock';

/** Intake facts retain their recorded wet mass; movement facts remain immutable. */
export async function getOutputStockHistory(ctx: OrgContext, storageLocationId: string): Promise<OutputStockHistoryEntry[]> {
  requireOrgScope(ctx);
  const [bin] = await db.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found');
  const movements = await db.select({ movement: binMovements, actorName: users.name }).from(binMovements)
    .leftJoin(users, eq(users.id, binMovements.createdBy))
    .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId))).orderBy(asc(binMovements.postingSequence));
  const rows = await getOutputStockAllocationProjection(ctx, { sourceStorageLocationId: storageLocationId });
  const products = await db.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, storageLocationId)));
  const runs = await db.select().from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, bin.facilityId)));
  const sources = await db.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId));
  const ingredients = products.length === 0 ? [] : await db.select().from(productIngredientSnapshots)
    .where(and(eq(productIngredientSnapshots.organizationId, ctx.organizationId), inArray(productIngredientSnapshots.biocharProductId, products.map(product => product.id))));
  const runCode = new Map(runs.map(r => [r.id, r.code]));
  const productCode = new Map(products.map(p => [p.id, p.code]));
  const history: OutputStockHistoryEntry[] = movements.filter(({ movement: m }) => m.outputKind).flatMap(({ movement: m, actorName }) => {
    const effects = rows.filter(r => r.movement.id === m.id);
    const allocations = [...new Map(effects.map(e => [e.allocation.id, e.allocation])).values()];
    const kind = m.inputSnapshot?.kind;
    const preview = m.inputSnapshot?.preview as Partial<OutputStockPreview> | undefined;
    const direction = m.outputKind === 'reversal' ? -1 : 1;
    const difference = (after: number | null | undefined, before: number | null | undefined) =>
      typeof after === 'number' && typeof before === 'number' ? direction * (after - before) : null;
    const targetProductId = m.inputSnapshot?.targetBiocharProductId;
    const deliveryId = allocations.find(a => a.deliveryId)?.deliveryId ?? (typeof m.inputSnapshot?.deliveryId === 'string' ? m.inputSnapshot.deliveryId : null);
    const savedSources = orderedSourcesSchema.safeParse(m.inputSnapshot?.sources);
    const correctionSources = savedSources.success ? savedSources.data : kind === 'loss' || kind === 'delivery'
      ? allocations.flatMap(a => a.basisSnapshot.readingPercent == null ? [] : [{ layerId: (a.biocharProductId ?? a.productionRunId)!, moisturePercent: Number(a.basisSnapshot.readingPercent) }]) : [];
    const entry: OutputStockHistoryEntry = { id: m.id, kind: m.outputKind!, eventKind: kind === 'loss' || kind === 'count' || kind === 'delivery' || kind === 'production_draw' ? kind : undefined,
      occurredAt: m.occurredAt!.toISOString(), recordedAt: m.createdAt.toISOString(), actorName,
      reason: m.reason, wetMassKg: typeof m.inputSnapshot?.wetMassKg === 'number' ? m.inputSnapshot.wetMassKg : null,
      moisturePercent: typeof m.inputSnapshot?.moisturePercent === 'number' ? m.inputSnapshot.moisturePercent : null,
      dryMassKg: -Number(m.outputDryDeltaKg), beforeDryKg: Number(m.balanceBeforeDryKg), afterDryKg: Number(m.balanceAfterDryKg),
      correctsMovementId: m.correctsMovementId, deliveryId,
      source: deliveryId ? { entity: 'delivery', id: deliveryId }
        : typeof targetProductId === 'string' ? { entity: 'biocharProduct', id: targetProductId } : undefined,
      wetDeltaKg: difference(preview?.afterEstimatedWetKg, preview?.beforeEstimatedWetKg),
      solidsDeltaKg: difference(preview?.afterSolidsKg, preview?.beforeSolidsKg),
      allocations: allocations.map(a => ({ layerId: (a.biocharProductId ?? a.productionRunId)!,
        code: (a.biocharProductId ? productCode.get(a.biocharProductId) : runCode.get(a.productionRunId!)) ?? String(a.basisSnapshot.code),
        wetMassKg: a.wetMassKg === null ? null : Number(a.wetMassKg), dryMassKg: Number(a.dryMassKg),
        runs: effects.filter(e => e.allocation.id === a.id && e.run).map(e => ({ productionRunId: e.run!.productionRunId, code: runCode.get(e.run!.productionRunId) ?? e.run!.productionRunId, dryMassKg: Number(e.run!.dryMassKg) })) })),
      ...(correctionSources.length ? { sources: correctionSources } : {}) };
    // A reading gets its own row right after the movement that measured it,
    // showing the change the operator saw when it was saved.
    const reset = m.outputKind === 'reversal' ? null : preview?.moistureReset;
    if (!reset) return [entry];
    return [entry, moistureUpdateEntry(entry, reset)];
  });
  const receipts = bin.type === 'product_bin' ? products.map(p => {
    const provenance = sources.filter(s => s.biocharProductId === p.id);
    const ingredientSolids = ingredients.filter(i => i.biocharProductId === p.id).reduce((sum, i) => sum + Number(i.drySolidsKg), 0);
    const composition = p.composition as { ingredients?: { massKg: number }[] };
    const resolved = (composition.ingredients ?? []).filter(i => i.massKg > 0).length === ingredients.filter(i => i.biocharProductId === p.id).length;
    return { solids: resolved ? provenance.reduce((sum, s) => sum + Number(s.allocatedDryMassKg), ingredientSolids) : null, id: p.id, code: p.code, occurredAt: p.placedAt.toISOString(), createdAt: p.createdAt,
      wet: Number(p.massKg ?? 0) + Number(p.waterAddedKg ?? 0), moisture: p.moistureContentPercent,
      dry: provenance.reduce((sum, s) => sum + Number(s.allocatedDryMassKg), 0),
      runs: provenance.map(s => ({ productionRunId: s.productionRunId, code: runCode.get(s.productionRunId) ?? s.productionRunId, dryMassKg: Number(s.allocatedDryMassKg) })) };
  }) : runs.filter(r => r.biocharStorageLocationId === storageLocationId && r.status === 'complete' && r.endTime).map(r => ({
    solids: r.biocharDryMassKg === null ? null : Number(r.biocharDryMassKg), id: r.id, code: r.code, occurredAt: r.endTime!.toISOString(), createdAt: r.createdAt,
    wet: Number(r.biocharOutputKg ?? 0), moisture: r.biocharMoisturePercent, dry: Number(r.biocharDryMassKg ?? 0),
    runs: [{ productionRunId: r.id, code: r.code, dryMassKg: Number(r.biocharDryMassKg ?? 0) }],
  }));
  for (const r of receipts) history.push({ id: r.id, kind: 'intake', occurredAt: r.occurredAt, recordedAt: r.createdAt.toISOString(), actorName: null,
    reason: `Intake ${r.code}`, wetMassKg: r.wet, moisturePercent: r.moisture, dryMassKg: -r.dry, beforeDryKg: 0, afterDryKg: 0,
    correctsMovementId: null, deliveryId: null, source: { entity: bin.type === 'product_bin' ? 'biocharProduct' : 'productionRun', id: r.id },
    wetDeltaKg: r.wet, solidsDeltaKg: r.solids, allocations: [{ layerId: r.id, code: r.code, wetMassKg: r.wet, dryMassKg: r.dry, runs: r.runs }] });
  history.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  let balance = 0;
  for (const entry of history) {
    if (entry.kind === 'intake') { entry.beforeDryKg = balance; entry.afterDryKg = balance - entry.dryMassKg; }
    balance -= entry.dryMassKg;
  }
  const latestSequence = movements.at(-1)?.movement.postingSequence ?? BigInt(0);
  const receiptFacts = [...products.map(product => ({ id: product.id, recordedAt: product.createdAt })),
    ...runs.filter(run => run.biocharStorageLocationId === storageLocationId && run.status === 'complete').map(run => ({ id: run.id, recordedAt: run.updatedAt }))];
  for (const entry of history) {
    if (entry.kind === 'reversal' || !['loss', 'delivery'].includes(entry.eventKind ?? entry.kind)) continue;
    const original = movements.find(row => row.movement.id === entry.id)?.movement;
    if (original) entry.editLockedReason = stockEntryLockReason(original, latestSequence, receiptFacts);
  }
  return history;
}

/** The "Moisture updated" row a movement's readings add to the bin's history. */
function moistureUpdateEntry(movement: OutputStockHistoryEntry, reset: OutputMoistureReset): OutputStockHistoryEntry {
  return { ...movement, id: `${movement.id}:moisture`, kind: 'moisture_update', eventKind: undefined, reason: '', wetMassKg: null, moisturePercent: null,
    dryMassKg: 0, beforeDryKg: movement.afterDryKg, correctsMovementId: null, deliveryId: null, allocations: [], sources: undefined,
    measuredByMovementId: movement.id, moistureReset: reset };
}
