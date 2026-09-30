import type { DbTransaction } from '@/db';
import { applications, binMovements, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { outputStockEventLabel } from '@/lib/output-stock/labels';
import { conflictCode } from '@/lib/conflict-ref';
import { STOCK_CONFLICT_ENTITY } from '@/lib/stock-conflict-entities';
import { ActionConflictError, SafeError } from '@/lib/errors';
import { formatFacilityDateTime } from '@/lib/format-utils';
import { add, grams, kilograms, readRational, type OutputStockLayer } from '@/lib/output-stock';
import type { OutputStockPreviewInput } from '@/types/output-stock';
import { and, eq, gt } from 'drizzle-orm';
import { getOutputStockAllocationProjection } from './output-stock';
import { getOutputStockFacilityTimezone } from './output-stock-dates';
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
  // A later oldest-first or pro-rata draw would have split differently had the
  // affected layers held other stock; an operator-ordered draw took only the
  // sub-bins it names, so it depends on the correction only if it touched one.
  const later = all.find(r => r.movement.postingSequence > original.postingSequence &&
    (affected.has(r.allocation.biocharProductId ?? r.allocation.productionRunId) ||
      (r.allocation.basisSnapshot.policy !== 'operator_order' &&
        affectedLayers.some(l => l.placedAt <= r.movement.occurredAt!.toISOString()))));

  // The bin is the record the operator opens to clear the way; the later
  // movement rides along as a blocker under the label its history row shows.
  const [bin] = await reader.select({ code: storageLocations.code }).from(storageLocations)
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, input.storageLocationId)));
  if (!bin) throw new SafeError('Storage location not found');
  const binConflict = { entity: STOCK_CONFLICT_ENTITY.storageLocation, id: input.storageLocationId, code: conflictCode(bin.code) };
  // Blockers name the movement by its facility time; the zone is read only when one is found.
  const blockedBy = async (movement: { id: string; reason: string; outputKind: string | null; occurredAt: Date | null }, message: (at: string) => string) => {
    const at = formatFacilityDateTime(movement.occurredAt!, await getOutputStockFacilityTimezone(ctx, input.facilityId, reader));
    return new ActionConflictError(message(at), binConflict, { blockers: [{ entity: STOCK_CONFLICT_ENTITY.binMovement, id: movement.id,
      code: conflictCode(`${movement.reason || outputStockEventLabel(movement.outputKind!)} (${at})`) }] });
  };
  if (later) throw await blockedBy(later.movement, at => `Correction blocked by a later ${outputStockEventLabel(later.movement.outputKind!).toLowerCase()}: ${later.movement.reason} (${at}).`);
  const counts = await reader.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, input.storageLocationId), gt(binMovements.postingSequence, original.postingSequence)));
  const count = counts.find(m => (m.outputKind === 'count' || m.inputSnapshot?.kind === 'count') && layers.some(l => affected.has(l.id) && l.placedAt <= m.occurredAt!.toISOString()));
  if (count) throw await blockedBy({ ...count, reason: 'Count' }, () => 'Correction blocked by a later count.');
  // A bin switched back to split held nothing then; restoring stock across the switch would put a mixed pile back as sub-bins.
  const split = counts.find(m => m.outputKind === 'split');
  if (split) throw await blockedBy(split, at => `Correction blocked by the switch to split at ${at}. Stock from before it cannot return to the bin.`);
  const deliveryId = allocations.find(a => a.deliveryId)?.deliveryId ?? null;
  if (deliveryId) {
    const [application] = await reader.select({ id: applications.id, code: applications.code }).from(applications).where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.deliveryId, deliveryId)));
    if (application) throw new ActionConflictError(`Correction blocked by application ${application.code}.`, { entity: "application", id: application.id, code: conflictCode(application.code) });
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
