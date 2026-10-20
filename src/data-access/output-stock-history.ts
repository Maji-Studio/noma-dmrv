import { deletedProductReversals } from './output-stock-active-movements';
import { db, type DbTransaction } from '@/db';
import { applications, binMovements, biocharProducts, biocharProductSourceAllocations, productionRuns, productIngredientSnapshots, storageLocations, users } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { ALREADY_CORRECTED_MESSAGE, ALREADY_DELETED_MESSAGE } from '@/lib/loss-correction-messages';
import { orderedSourcesSchema } from '@/schemas/output-stock';
import type { OutputMoistureReset, OutputStockHistoryEntry, OutputStockPreview } from '@/types/output-stock';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getOutputStockAllocationProjection, readOutputBinAllLayers, UnresolvedOutputStockError } from './output-stock';
import { getOutputMovementCertificationLocks, outputMovementLockReason } from './output-stock-edit-lock';
import { requireOrgScope } from './utils';
import { deliveryAppliedLockedReason } from '@/lib/output-stock/labels';
import { entryIngredientSolids, type EntryDraw } from '@/lib/output-stock/entry-ingredient-solids';
import { rationalToNumber, readRational } from '@/lib/output-stock/exact';
import { savedIngredientSolids } from './output-stock-ingredients';

/**
 * Intake facts retain their recorded wet mass; movement facts remain immutable.
 * A snapshot read passes its transaction as `reader`, so history and stock agree.
 */
export async function getOutputStockHistory(ctx: OrgContext, storageLocationId: string, reader: Pick<DbTransaction, 'select' | 'selectDistinct'> = db): Promise<OutputStockHistoryEntry[]> {
  requireOrgScope(ctx);
  const [bin] = await reader.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found');
  const movements = await reader.select({ movement: binMovements, actorName: users.name }).from(binMovements)
    .leftJoin(users, eq(users.id, binMovements.createdBy))
    .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId))).orderBy(asc(binMovements.postingSequence));
  const rows = await getOutputStockAllocationProjection(ctx, { sourceStorageLocationId: storageLocationId }, reader);
  const products = await reader.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, storageLocationId)));
  const runs = await reader.select().from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, bin.facilityId)));
  const sources = await reader.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId));
  const ingredients = products.length === 0 ? [] : await reader.select().from(productIngredientSnapshots)
    .where(and(eq(productIngredientSnapshots.organizationId, ctx.organizationId), inArray(productIngredientSnapshots.biocharProductId, products.map(product => product.id))));
  const deletedPlacements = products.length === 0 ? [] : await deletedProductReversals(ctx, reader, products.map(product => product.id));
  const runCode = new Map(runs.map(r => [r.id, r.code]));
  const productCode = new Map(products.map(p => [p.id, p.code]));
  // Each movement's batches with the exact solids they froze, so a draw whose dry biochar rounds to zero still splits its ingredients.
  const exactDraws = new Map<string, EntryDraw[]>();
  const history: OutputStockHistoryEntry[] = movements.filter(({ movement: m }) => m.outputKind).flatMap(({ movement: m, actorName }) => {
    const effects = rows.filter(r => r.movement.id === m.id);
    const allocations = [...new Map(effects.map(e => [e.allocation.id, e.allocation])).values()];
    exactDraws.set(m.id, allocations.map(a => ({ layerId: (a.biocharProductId ?? a.productionRunId)!, dryMassKg: Number(a.dryMassKg),
      solidsKg: frozenSolidsKg(a.basisSnapshot.solidsKg) })));
    const kind = m.inputSnapshot?.kind;
    const preview = m.inputSnapshot?.preview as Partial<OutputStockPreview> | undefined;
    const direction = m.outputKind === 'reversal' ? -1 : 1;
    const difference = (after: number | null | undefined, before: number | null | undefined) =>
      typeof after === 'number' && typeof before === 'number' ? direction * (after - before) : null;
    const targetProductId = m.inputSnapshot?.targetBiocharProductId;
    const deliveryId = allocations.find(a => a.deliveryId)?.deliveryId ?? (typeof m.inputSnapshot?.deliveryId === 'string' ? m.inputSnapshot.deliveryId : null);
    const savedSources = orderedSourcesSchema.safeParse(m.inputSnapshot?.sources);
    const drawPolicy = allocations[0]?.basisSnapshot.policy;
    // Default split draws have no saved sources. Replay their frozen draw order,
    // never allocation UUID order or a pro-rata mix as an ordered draw.
    const splitDraw = (drawPolicy === 'fifo' || drawPolicy === 'lifo') && allocations.every(a => a.basisSnapshot.policy === drawPolicy);
    const drawAllocations = splitDraw ? [...allocations].sort((a, b) => {
      const placement = String(a.basisSnapshot.placedAt).localeCompare(String(b.basisSnapshot.placedAt));
      const aSequence = BigInt(String(a.basisSnapshot.postingSequence));
      const bSequence = BigInt(String(b.basisSnapshot.postingSequence));
      return placement || (aSequence < bSequence ? -1 : aSequence > bSequence ? 1 : 0);
    }) : [];
    if (drawPolicy === 'lifo') drawAllocations.reverse();
    const correctionSources = savedSources.success ? savedSources.data : kind === 'loss' || kind === 'delivery'
      ? drawAllocations.flatMap(a => a.basisSnapshot.readingPercent == null ? [] : [{ layerId: (a.biocharProductId ?? a.productionRunId)!, moisturePercent: Number(a.basisSnapshot.readingPercent) }]) : [];
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
      afterWetKg: typeof preview?.afterEstimatedWetKg === 'number' ? preview.afterEstimatedWetKg : null,
      afterSolidsKg: typeof preview?.afterSolidsKg === 'number' ? preview.afterSolidsKg : null,
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
  // Each product's dry biochar, worked out once: the intake's own figure and the ingredient split's denominator.
  const productDryKg = new Map(products.map(p => [p.id, sources.filter(s => s.biocharProductId === p.id).reduce((sum, s) => sum + Number(s.allocatedDryMassKg), 0)]));
  const receipts = bin.type === 'product_bin' ? products.map(p => {
    const provenance = sources.filter(s => s.biocharProductId === p.id);
    const dry = productDryKg.get(p.id) ?? 0;
    const ingredientSolids = ingredients.filter(i => i.biocharProductId === p.id).reduce((sum, i) => sum + Number(i.drySolidsKg), 0);
    const composition = p.composition as { ingredients?: { massKg: number }[] };
    const resolved = (composition.ingredients ?? []).filter(i => i.massKg > 0).length === ingredients.filter(i => i.biocharProductId === p.id).length;
    return { solids: resolved ? dry + ingredientSolids : null, id: p.id, code: p.code, occurredAt: p.placedAt.toISOString(), recordedAt: p.createdAt,
      wet: Number(p.massKg ?? 0) + Number(p.waterAddedKg ?? 0), moisture: p.moistureContentPercent,
      dry,
      runs: provenance.map(s => ({ productionRunId: s.productionRunId, code: runCode.get(s.productionRunId) ?? s.productionRunId, dryMassKg: Number(s.allocatedDryMassKg) })) };
  }) : runs.filter(r => r.biocharStorageLocationId === storageLocationId && r.status === 'complete' && r.endTime).map(r => ({
    // A product posts its stock when it is created; a run posts its output when it is completed (or its output last changed), never at creation.
    solids: r.biocharDryMassKg === null ? null : Number(r.biocharDryMassKg), id: r.id, code: r.code, occurredAt: r.endTime!.toISOString(), recordedAt: r.updatedAt,
    wet: Number(r.biocharOutputKg ?? 0), moisture: r.biocharMoisturePercent, dry: Number(r.biocharDryMassKg ?? 0),
    runs: [{ productionRunId: r.id, code: r.code, dryMassKg: Number(r.biocharDryMassKg ?? 0) }],
  }));
  for (const r of receipts) history.push({ id: r.id, kind: 'intake', occurredAt: r.occurredAt, recordedAt: r.recordedAt.toISOString(), actorName: null,
    reason: `Intake ${r.code}`, wetMassKg: r.wet, moisturePercent: r.moisture, dryMassKg: -r.dry, beforeDryKg: 0, afterDryKg: 0,
    correctsMovementId: null, deliveryId: null, source: { entity: bin.type === 'product_bin' ? 'biocharProduct' : 'productionRun', id: r.id },
    // Every batch enters with its wet mass: a product's moisture is required, and the database
    // refuses a complete run without moisture, output above zero and a bin (production_runs_complete_has_output).
    wetDeltaKg: r.wet, solidsDeltaKg: r.solids, allocations: [{ layerId: r.id, code: r.code, wetMassKg: r.wet, dryMassKg: r.dry, runs: r.runs }] });
  for (const [productId, movement] of new Map(deletedPlacements.map(row => [row.id, row.movement]))) {
    const intake = history.find(entry => entry.kind === 'intake' && entry.id === productId);
    if (!intake) continue;
    history.push({ ...intake, id: `${movement.id}:placement`, kind: 'reversal', correctsMovementId: intake.id,
      recordedAt: movement.createdAt.toISOString(), reason: movement.reason,
      dryMassKg: -intake.dryMassKg, wetDeltaKg: intake.wetDeltaKg == null ? null : -intake.wetDeltaKg, solidsDeltaKg: intake.solidsDeltaKg == null ? null : -intake.solidsDeltaKg });
  }
  if (bin.type === 'product_bin') {
    // Each entry's ingredient solids by material, in the shares its products saved: the history's per-part changes.
    const saved = await savedIngredientSolids(ctx, products.map(p => p.id), reader);
    for (const entry of history) {
      const parts = entryIngredientSolids({ dryChangeKg: -entry.dryMassKg, solidsChangeKg: entry.solidsDeltaKg ?? null, draws: exactDraws.get(entry.id) ?? entry.allocations, productDryKg, saved });
      if (parts.some(part => part.solidsKg !== 0)) entry.ingredientSolidsDeltas = parts;
    }
  }
  history.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  let balance = 0;
  for (const entry of history) {
    if (entry.kind === 'intake' || entry.id.endsWith(':placement')) { entry.beforeDryKg = balance; entry.afterDryKg = balance - entry.dryMassKg; }
    balance -= entry.dryMassKg;
  }
  // The correction path refuses an applied delivery too; locking it here keeps the delivery's other fields saveable.
  const deliveryIds = [...new Set(history.flatMap(entry => entry.deliveryId ? [entry.deliveryId] : []))];
  const applied = deliveryIds.length === 0 ? [] : await reader.select({ deliveryId: applications.deliveryId, code: applications.code }).from(applications)
    .where(and(eq(applications.organizationId, ctx.organizationId), inArray(applications.deliveryId, deliveryIds)));
  const applicationCode = new Map(applied.map(row => [row.deliveryId, row.code]));
  let layers: Awaited<ReturnType<typeof readOutputBinAllLayers>>['layers'] | null = null;
  try {
    ({ layers } = await readOutputBinAllLayers(ctx, storageLocationId, reader, { includeArchived: true }));
  } catch (error) {
    if (!(error instanceof UnresolvedOutputStockError)) throw error;
  }
  const editableIds = history.filter(entry => entry.kind !== 'reversal' && ['loss', 'delivery'].includes(entry.eventKind ?? entry.kind)).map(entry => entry.id);
  const certificationLocks = await getOutputMovementCertificationLocks(ctx, reader, editableIds, rows);
  const reversedIds = new Set(movements.filter(({ movement }) => movement.outputKind === 'reversal').map(({ movement }) => movement.correctsMovementId));
  const replacedIds = new Set(movements.filter(({ movement }) => movement.outputKind === 'replacement').map(({ movement }) => movement.correctsMovementId));
  for (const entry of history) {
    if (entry.kind === 'reversal' || !['loss', 'delivery'].includes(entry.eventKind ?? entry.kind)) continue;
    if (reversedIds.has(entry.id)) {
      entry.editLockedReason = replacedIds.has(entry.id) ? ALREADY_CORRECTED_MESSAGE : ALREADY_DELETED_MESSAGE;
      continue;
    }
    const original = movements.find(row => row.movement.id === entry.id)?.movement;
    const code = entry.deliveryId ? applicationCode.get(entry.deliveryId) : undefined;
    if (original) entry.editLockedReason = code ? deliveryAppliedLockedReason(code) : await outputMovementLockReason(ctx, storageLocationId, original.id, reader, { original, facilityId: bin.facilityId, all: rows, layers, certificationLocks: certificationLocks.get(original.id) ?? [] });
  }
  return history;
}

/** An allocation's frozen exact solids, or null when the snapshot has none; an unreadable one throws, as on every posting path. */
function frozenSolidsKg(value: unknown): number | null {
  return value == null ? null : rationalToNumber(readRational(value));
}

/** The "Moisture updated" row a movement's readings add to the bin's history. */
function moistureUpdateEntry(movement: OutputStockHistoryEntry, reset: OutputMoistureReset): OutputStockHistoryEntry {
  return { ...movement, id: `${movement.id}:moisture`, kind: 'moisture_update', eventKind: undefined, reason: '', wetMassKg: null, moisturePercent: null,
    dryMassKg: 0, beforeDryKg: movement.afterDryKg, correctsMovementId: null, deliveryId: null, allocations: [], sources: undefined,
    measuredByMovementId: movement.id, moistureReset: reset };
}
