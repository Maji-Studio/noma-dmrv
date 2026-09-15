import type { DbTransaction } from '@/db';
import { applications, binMovements } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { outputStockEventLabel } from '@/lib/output-stock/labels';
import { ActionConflictError, SafeError } from '@/lib/errors';
import { add, grams, kilograms, readRational, type OutputStockLayer } from '@/lib/output-stock';
import type { OutputStockPreviewInput } from '@/types/output-stock';
import { and, eq, gt } from 'drizzle-orm';
import { getOutputStockAllocationProjection } from './output-stock';
import { requireOrgScope } from './utils';

/** Simulate restoring only the original immutable effects; never reconstruct FIFO. */
export async function prepareOutputCorrection(ctx: OrgContext, input: OutputStockPreviewInput, layers: OutputStockLayer[], reader: Pick<DbTransaction, 'select'>, replacementLayerIds: string[] = []) {
  requireOrgScope(ctx);
  const [original] = await reader.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.id, input.correctsMovementId!), eq(binMovements.storageLocationId, input.storageLocationId)));
  if (!original?.outputKind || ['reversal', 'production_draw', 'product_draw'].includes(original.outputKind)) throw new SafeError('Choose a posted delivery, loss, or count to correct.');
  const originalKind = original.outputKind === 'replacement' ? original.inputSnapshot?.kind : original.outputKind;
  if (originalKind !== input.kind) throw new SafeError('The replacement must use the original event kind.');
  const [existing] = await reader.select({ id: binMovements.id }).from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.correctsMovementId, original.id)));
  if (existing) throw new SafeError('This entry has already been corrected. Choose its replacement.');
  const all = await getOutputStockAllocationProjection(ctx, { sourceStorageLocationId: input.storageLocationId }, reader);
  const rows = all.filter(r => r.movement.id === original.id);
  const allocations = [...new Map(rows.map(r => [r.allocation.id, r.allocation])).values()];
  const observedLayers = originalKind === 'count' ? ((original.inputSnapshot?.preview as { beforeAllocations?: { layerId: string }[] } | undefined)?.beforeAllocations ?? []).map(l => l.layerId) : [];
  const affected = new Set([...allocations.map(a => a.biocharProductId ?? a.productionRunId), ...replacementLayerIds, ...observedLayers]);
  const affectedLayers = layers.filter(l => affected.has(l.id));
  const later = all.find(r => r.movement.postingSequence > original.postingSequence &&
    (affected.has(r.allocation.biocharProductId ?? r.allocation.productionRunId) ||
      affectedLayers.some(l => l.physicalDate <= r.movement.physicalDate!)));

  if (later) throw new ActionConflictError(`Correction blocked by a later ${outputStockEventLabel(later.movement.outputKind!).toLowerCase()}.`, { entity: "binMovement", id: later.movement.id, code: `${outputStockEventLabel(later.movement.outputKind!)} ${later.movement.physicalDate}` });
  const counts = await reader.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, input.storageLocationId), gt(binMovements.postingSequence, original.postingSequence)));
  const count = counts.find(m => (m.outputKind === 'count' || m.inputSnapshot?.kind === 'count') && layers.some(l => affected.has(l.id) && l.physicalDate <= m.physicalDate!));
  if (count) throw new ActionConflictError("Correction blocked by a later count.", { entity: "binMovement", id: count.id, code: `Count ${count.physicalDate}` });
  const deliveryId = allocations.find(a => a.deliveryId)?.deliveryId ?? null;
  if (deliveryId) {
    const [application] = await reader.select({ id: applications.id, code: applications.code }).from(applications).where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.deliveryId, deliveryId)));
    if (application) throw new ActionConflictError(`Correction blocked by application ${application.code}.`, { entity: "application", id: application.id, code: application.code });
  }
  const restored = layers.map(layer => {
    const effects = allocations.filter(a => (a.biocharProductId ?? a.productionRunId) === layer.id);
    if (!effects.length) return layer;
    const dry = grams(layer.remainingDryBiocharKg) + effects.reduce((sum, a) => sum + grams(a.dryMassKg), BigInt(0));
    if (dry > grams(layer.establishedDryBiocharKg)) throw new SafeError('Correction would exceed original stock.');
    return { ...layer, remainingDryBiocharKg: kilograms(dry),
      remainingSolidsKg: effects.reduce((sum, a) => add(sum, readRational(a.basisSnapshot.solidsKg)), layer.remainingSolidsKg!),
      runs: layer.runs.map(run => {
        const restoredDry = grams(run.remainingDryKg) + rows.filter(r => effects.some(a => a.id === r.allocation.id) && r.run?.productionRunId === run.productionRunId).reduce((sum, r) => sum + grams(r.run!.dryMassKg), BigInt(0));
        if (restoredDry > grams(run.establishedDryKg)) throw new SafeError('Correction would exceed original run provenance.');
        return { ...run, remainingDryKg: kilograms(restoredDry) };
      }) };
  });
  return { original, allocations, rows, layers: restored, deliveryId };
}
