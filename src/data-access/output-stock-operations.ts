import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, formulations, productionRuns, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { ActionConflictError, SafeError } from '@/lib/errors';
import { add, compare, decimal, divide, grams, kilograms, multiply, operatorStockMessage, planOutputStock, rational, readRational, subtract, type OutputStockLayer, type Rational } from '@/lib/output-stock';
import { outputStockPreviewSchema } from '@/schemas/output-stock';
import type { MatchingOutputBin, OutputStockPreview, OutputStockPreviewInput } from '@/types/output-stock';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requestFingerprint } from './bin-movement-requests';
import { getBiocharOutputStockLayers, getOutputBinStockView, getProductOutputStockLayers } from './output-stock';
import { getCertifiedLineage } from './certification-lineage-guards';
import { prepareOutputCorrection } from './output-stock-corrections';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;
export const rationalNumber = (value: Rational) => Number(value.numerator) / Number(value.denominator);
/** Output-lane alias of the shared request digest. */
export { requestFingerprint as stockFingerprint };

/** One read/plan seam shared by previews and locked writes. */
export async function prepareOutputStock(ctx: OrgContext, raw: OutputStockPreviewInput, reader: Reader = db) {
  requireOrgScope(ctx);
  const input = outputStockPreviewSchema.parse(raw);
  const [bin] = await reader.select().from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, input.storageLocationId),
    eq(storageLocations.facilityId, input.facilityId), isNull(storageLocations.archivedAt)));
  if (!bin || !['biochar_bin', 'product_bin'].includes(bin.type)) throw new SafeError('Output bin not found or archived');
  const lane = bin.type === 'biochar_bin' ? 'biochar' as const : 'product' as const;
  if (input.kind === 'delivery' && lane !== 'product') throw new SafeError('Choose a product bin for delivery.');
  if (input.kind === 'production_draw' && lane !== 'biochar') throw new SafeError('Choose a biochar bin for product creation.');
  const state = lane === 'biochar' ? await getBiocharOutputStockLayers(ctx, input, reader) : await getProductOutputStockLayers(ctx, input, reader);
  const correction = input.correctsMovementId ? await prepareOutputCorrection(ctx, input, state.layers, reader) : null;
  const layers = correction?.layers ?? state.layers;
  // Reducing a loss restores its own saved provenance, even after a late intake.
  // An eligible delivery correction may intentionally use the newly known FIFO.
  const originalSolids = correction?.allocations.reduce((sum, a) => add(sum, readRational(a.basisSnapshot.solidsKg)), rational(BigInt(0)));
  const replacementSolids = input.kind === 'loss' ? multiply(decimal(input.wetMassKg), subtract(rational(BigInt(1)), divide(decimal(input.moisturePercent!), rational(BigInt(100))))) : null;
  const preserveLossSources = originalSolids && replacementSolids && compare(replacementSolids, originalSolids) <= BigInt(0);
  const planningLayers = preserveLossSources ? layers.filter(l => correction!.allocations.some(a => (a.biocharProductId ?? a.productionRunId) === l.id)) : layers;
  const events = await reader.select({ id: binMovements.id, sequence: binMovements.postingSequence })
    .from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, bin.id))).orderBy(asc(binMovements.postingSequence));
  const basisFingerprint = requestFingerprint({ layers, events, formulationId: bin.formulationId, physicalDate: input.physicalDate, correctsMovementId: input.correctsMovementId });
  const codes = lane === 'product'
    ? await reader.select({ id: biocharProducts.id, code: biocharProducts.code }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, bin.id)))
    : await reader.select({ id: productionRuns.id, code: productionRuns.code }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, bin.id)));
  const codeMap = new Map(codes.map(row => [row.id, row.code]));
  const runCodes = await reader.select({ id: productionRuns.id, code: productionRuns.code }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, input.facilityId)));
  const runMap = new Map(runCodes.map(row => [row.id, row.code]));
  const before = planOutputStock(layers, input.physicalDate, { kind: 'count', wetKg: 0 });
  let plan: ReturnType<typeof planOutputStock> | null = null;
  let blockingMessage: string | null = null;
  try {
    plan = planOutputStock(planningLayers, input.physicalDate, input.kind === 'count'
      ? { kind: 'count', wetKg: input.wetMassKg, moisturePercent: input.moisturePercent ?? undefined }
      : { kind: 'wet', wetKg: input.wetMassKg, moisturePercent: input.moisturePercent! });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    blockingMessage = operatorStockMessage(error.message);
  }
  if (correction && plan) await prepareOutputCorrection(ctx, input, state.layers, reader, plan.allocations.map(a => a.layerId));
  const beforeDryKg = Number(kilograms(layers.filter(l => l.physicalDate <= input.physicalDate).reduce((sum, l) => sum + grams(l.remainingDryBiocharKg), BigInt(0))));
  const beforeSolidsKg = rationalNumber(before.expectedSolidsKg);
  const removedSolids = plan?.allocations.reduce((sum, a) => add(sum, a.solidsKg), rational(BigInt(0))) ?? rational(BigInt(0));
  const afterSolidsKg = beforeSolidsKg - rationalNumber(removedSolids);
  const moisture = input.moisturePercent ?? null;
  const fraction = moisture === null ? null : 1 - moisture / 100;
  const layerViews = (viewLayers: OutputStockLayer[]) => viewLayers.filter(l => l.physicalDate <= input.physicalDate).sort((a, b) => a.physicalDate.localeCompare(b.physicalDate) || (a.postingSequence < b.postingSequence ? -1 : 1)).map(l => ({
    layerId: l.id, code: codeMap.get(l.id) ?? l.id, dryMassKg: Number(l.remainingDryBiocharKg),
    wetMassKg: fraction ? rationalNumber(l.remainingSolidsKg!) / fraction : null,
    runs: l.runs.map(r => ({ productionRunId: r.productionRunId, code: runMap.get(r.productionRunId) ?? r.productionRunId, dryMassKg: Number(r.remainingDryKg) })),
  }));
  const [formulation] = bin.formulationId ? await reader.select({ name: formulations.name }).from(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, bin.formulationId))) : [];
  const afterLayers = layers.map(l => plan?.remainingLayers.find(a => a.id === l.id) ?? l);
  const preview: OutputStockPreview = {
    basisFingerprint, storageLocationId: bin.id, binName: bin.name, binCode: bin.code, formulationName: formulation?.name ?? null, lane, beforeDryKg,
    beforeAllocations: layerViews(layers), afterAllocations: layerViews(afterLayers),
    afterDryKg: beforeDryKg - Number(plan?.drawnDryKg ?? 0), beforeSolidsKg, afterSolidsKg,
    removedDryKg: Number(plan?.drawnDryKg ?? 0), removedWetKg: input.kind === 'count' ? null : input.wetMassKg,
    estimateMoisturePercent: moisture, beforeEstimatedWetKg: fraction ? beforeSolidsKg / fraction : null,
    afterEstimatedWetKg: fraction ? afterSolidsKg / fraction : null,
    discrepancySolidsKg: plan ? rationalNumber(plan.discrepancySolidsKg) : 0,
    allocations: plan?.allocations.map(a => ({ layerId: a.layerId, code: codeMap.get(a.layerId) ?? a.layerId,
      dryMassKg: Number(a.dryKg), wetMassKg: a.wetShareKg ? rationalNumber(a.wetShareKg) : null,
      runs: a.runs.map(r => ({ productionRunId: r.productionRunId, code: runMap.get(r.productionRunId) ?? r.productionRunId, dryMassKg: Number(r.dryKg) })) })) ?? [], blockingMessage,
  };
  return { input, bin, lane, layers, plan, preview, correction };
}
export async function previewOutputStock(ctx: OrgContext, input: OutputStockPreviewInput): Promise<OutputStockPreview> {
  requireOrgScope(ctx);
  try {
    return await db.transaction(async tx => {
      const prepared = await prepareOutputStock(ctx, input, tx);
      if (prepared.correction && prepared.plan) {
        const targets = prepared.layers.filter(layer => prepared.plan!.allocations.some(a => a.layerId === layer.id) || prepared.correction!.allocations.some(a => (a.biocharProductId ?? a.productionRunId) === layer.id))
          .map(layer => ({ entityType: prepared.lane === 'product' ? 'biocharProduct' as const : 'productionRun' as const, entityId: layer.id }));
        const lineage = (await Promise.all(targets.map(target => getCertifiedLineage(ctx, tx, target)))).flat();
        if (prepared.correction.deliveryId) lineage.push(...await getCertifiedLineage(ctx, tx, { entityType: 'delivery', entityId: prepared.correction.deliveryId }));
        const blockers = lineage.filter(row => row.removalSubmissionId || row.ghgStatementSubmissionId).map(row => ({
          entity: row.ghgStatementSubmissionId ? 'ghgStatement' : 'removal',
          id: row.ghgStatementSubmissionId ? row.ghgStatementId! : row.removalId,
          code: row.ghgStatementSubmissionId ? 'GHG Statement' : 'Removal',
        }));
        if (blockers.length) return { ...prepared.preview, blockingMessage: 'Correction blocked by certification. Open the linked artifact to review its dependencies.', blockers: [...new Map(blockers.map(b => [b.id, b])).values()] };
      }
      return prepared.preview;
    });
  } catch (error) {
    if (!(error instanceof ActionConflictError)) throw error;
    const preview = (await prepareOutputStock(ctx, { ...input, correctsMovementId: undefined })).preview;
    return { ...preview, afterDryKg: preview.beforeDryKg, afterSolidsKg: preview.beforeSolidsKg, afterEstimatedWetKg: preview.beforeEstimatedWetKg, afterAllocations: preview.beforeAllocations, allocations: [], removedDryKg: 0, removedWetKg: null, blockingMessage: `${error.message} Replacement balances are unavailable until this dependency is resolved.`, blockers: error.blockers ?? [error.conflict] };
  }
}
export async function getMatchingOutputBins(ctx: OrgContext, input: { facilityId: string; formulationId: string }): Promise<MatchingOutputBin[]> {
  requireOrgScope(ctx);
  const [formulation] = await db.select({ id: formulations.id }).from(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, input.formulationId)));
  if (!formulation) throw new SafeError('Formulation not found');
  const bins = await db.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.facilityId, input.facilityId), eq(storageLocations.type, 'product_bin'), eq(storageLocations.formulationId, input.formulationId), isNull(storageLocations.archivedAt))).orderBy(asc(storageLocations.code));
  // Orders carry no departure moisture, so wet availability is the bin's
  // estimate at each batch's recorded moisture, as the bin selectors show it.
  // A bin whose layers do not resolve reads null instead of failing the list.
  return Promise.all(bins.map(async bin => {
    const { dryMassKg, estimatedWetMassKg } = await getOutputBinStockView(ctx, bin.id);
    return { id: bin.id, code: bin.code, name: bin.name, dryMassKg, recordedWetMassKg: null, estimatedWetMassKg };
  }));
}
export { getOutputStockHistory } from './output-stock-history';
