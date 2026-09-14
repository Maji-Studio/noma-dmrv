import { db } from '@/db';
import { binMovements, biocharProducts, biocharProductSourceAllocations, productionRuns, storageLocations, users } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import type { OutputStockHistoryEntry } from '@/types/output-stock';
import { and, asc, eq } from 'drizzle-orm';
import { getOutputStockAllocationProjection } from './output-stock';
import { requireOrgScope } from './utils';

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
  const runCode = new Map(runs.map(r => [r.id, r.code]));
  const productCode = new Map(products.map(p => [p.id, p.code]));
  const history: OutputStockHistoryEntry[] = movements.filter(({ movement: m }) => m.outputKind).map(({ movement: m, actorName }) => {
    const effects = rows.filter(r => r.movement.id === m.id);
    const allocations = [...new Map(effects.map(e => [e.allocation.id, e.allocation])).values()];
    const kind = m.inputSnapshot?.kind;
    return { id: m.id, kind: m.outputKind!, eventKind: kind === 'loss' || kind === 'count' || kind === 'delivery' || kind === 'production_draw' ? kind : undefined,
      physicalDate: m.physicalDate!, recordedAt: m.createdAt.toISOString(), actorName,
      reason: m.reason, wetMassKg: typeof m.inputSnapshot?.wetMassKg === 'number' ? m.inputSnapshot.wetMassKg : null,
      moisturePercent: typeof m.inputSnapshot?.moisturePercent === 'number' ? m.inputSnapshot.moisturePercent : null,
      dryMassKg: -Number(m.outputDryDeltaKg), beforeDryKg: Number(m.balanceBeforeDryKg), afterDryKg: Number(m.balanceAfterDryKg),
      correctsMovementId: m.correctsMovementId, deliveryId: allocations.find(a => a.deliveryId)?.deliveryId ?? null,
      allocations: allocations.map(a => ({ layerId: (a.biocharProductId ?? a.productionRunId)!,
        code: (a.biocharProductId ? productCode.get(a.biocharProductId) : runCode.get(a.productionRunId!)) ?? String(a.basisSnapshot.code),
        wetMassKg: a.wetMassKg === null ? null : Number(a.wetMassKg), dryMassKg: Number(a.dryMassKg),
        runs: effects.filter(e => e.allocation.id === a.id && e.run).map(e => ({ productionRunId: e.run!.productionRunId, code: runCode.get(e.run!.productionRunId) ?? e.run!.productionRunId, dryMassKg: Number(e.run!.dryMassKg) })) })) };
  });
  const receipts = bin.type === 'product_bin' ? products.map(p => {
    const provenance = sources.filter(s => s.biocharProductId === p.id);
    return { id: p.id, code: p.code, physicalDate: p.placedAt, createdAt: p.createdAt,
      wet: Number(p.massKg ?? 0) + Number(p.waterAddedKg ?? 0), moisture: p.moistureContentPercent,
      dry: provenance.reduce((sum, s) => sum + Number(s.allocatedDryMassKg), 0),
      runs: provenance.map(s => ({ productionRunId: s.productionRunId, code: runCode.get(s.productionRunId) ?? s.productionRunId, dryMassKg: Number(s.allocatedDryMassKg) })) };
  }) : runs.filter(r => r.biocharStorageLocationId === storageLocationId && r.status === 'complete' && r.endTime).map(r => ({
    id: r.id, code: r.code, physicalDate: r.endTime!.toISOString().slice(0, 10), createdAt: r.createdAt,
    wet: Number(r.biocharOutputKg ?? 0), moisture: r.biocharMoisturePercent, dry: Number(r.biocharDryMassKg ?? 0),
    runs: [{ productionRunId: r.id, code: r.code, dryMassKg: Number(r.biocharDryMassKg ?? 0) }],
  }));
  for (const r of receipts) history.push({ id: r.id, kind: 'intake', physicalDate: r.physicalDate, recordedAt: r.createdAt.toISOString(), actorName: null,
    reason: `Intake ${r.code}`, wetMassKg: r.wet, moisturePercent: r.moisture, dryMassKg: -r.dry, beforeDryKg: 0, afterDryKg: 0,
    correctsMovementId: null, deliveryId: null, allocations: [{ layerId: r.id, code: r.code, wetMassKg: r.wet, dryMassKg: r.dry, runs: r.runs }] });
  history.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  let balance = 0;
  for (const entry of history) {
    if (entry.kind === 'intake') { entry.beforeDryKg = balance; entry.afterDryKg = balance - entry.dryMassKg; }
    balance -= entry.dryMassKg;
  }
  return history;
}
