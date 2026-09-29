import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, formulations, productionRuns, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { ActionConflictError, SafeError } from '@/lib/errors';
import { add, compare, decimal, divide, grams, kilograms, multiply, operatorStockMessage, planOutputStock, rational, readRational, rationalToNumber, SubBinOverdrawError, subtract, UntickSubBinError, PRO_RATA_POLICY, type DrawPolicy, type OutputStockLayer, type OutputStockRequest } from '@/lib/output-stock';
import { mixPileName, outputStockEventLabel } from '@/lib/output-stock/labels';
import { stockModeAt, type OutputStockMode, type StockModeChange } from '@/lib/output-stock/stock-mode';
import { estimateStock, planReadings, withReadings, type LayerMoistureBasis, type PlannedReading } from '@/lib/output-stock/moisture-estimate';
import { formatFacilityDateTime } from '@/lib/format-utils';
import { formatMoisturePercent, PERCENT_SCALE } from '@/lib/mass-moisture';
import { STORED_PERCENT_INPUT_STEP } from '@/schemas/helpers';
import { orderedSourcesSchema, outputStockPreviewSchema } from '@/schemas/output-stock';
import type { MatchingOutputBin, OutputStockPreview, OutputStockPreviewInput } from '@/types/output-stock';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requestFingerprint } from './bin-movement-requests';
import { getBiocharOutputStockLayers, getLayerMoistureBases, getOutputBinStockView, getProductOutputStockLayers } from './output-stock';
import { getCertifiedLineage } from './certification-lineage-guards';
import { getStockModeChanges } from './output-bin-stock-mode';
import { getOutputStockFacilityTimezone } from './output-stock-dates';
import { prepareOutputCorrection } from './output-stock-corrections';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;
export const rationalNumber = rationalToNumber;
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
  // A correction may name its own sub-bins and readings; otherwise it replays the original's.
  const sources = input.sources ?? (correction ? savedSources(correction.original.inputSnapshot) : undefined);
  // A merged bin stays split before its merge, so an entry timed before it is planned as split.
  const modeChanges = await getStockModeChanges(ctx, bin.id, reader);
  const stockMode = stockModeAt(bin.stockMode, modeChanges, input.occurredAt);
  const policy: DrawPolicy = stockMode === 'mix' ? PRO_RATA_POLICY : 'fifo';
  if (sources && stockMode !== 'split') throw new SafeError('Only a split bin takes a sub-bin order.');
  if (!sources && input.moisturePercent == null && !(input.kind === 'count' && input.wetMassKg === 0)) throw new SafeError('Enter the measured moisture.');
  // Reducing a loss restores its own saved provenance, even after a late intake.
  // An eligible delivery correction may intentionally use the newly known FIFO.
  const originalSolids = correction?.allocations.reduce((sum, a) => add(sum, readRational(a.basisSnapshot.solidsKg)), rational(BigInt(0)));
  const replacementSolids = input.kind === 'loss' && !sources ? multiply(decimal(input.wetMassKg), subtract(rational(BigInt(1)), divide(decimal(input.moisturePercent!), rational(BigInt(100))))) : null;
  const preserveLossSources = originalSolids && replacementSolids && compare(replacementSolids, originalSolids) <= BigInt(0);
  const planningLayers = preserveLossSources ? layers.filter(l => correction!.allocations.some(a => (a.biocharProductId ?? a.productionRunId) === l.id)) : layers;
  const events = await reader.select({ id: binMovements.id, sequence: binMovements.postingSequence, kind: binMovements.outputKind, occurredAt: binMovements.occurredAt, reason: binMovements.reason, correctsMovementId: binMovements.correctsMovementId })
    .from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, bin.id))).orderBy(asc(binMovements.postingSequence));
  const basisFingerprint = requestFingerprint({ layers, events: events.map(e => ({ id: e.id, sequence: e.sequence })), formulationId: bin.formulationId, occurredAt: input.occurredAt, correctsMovementId: input.correctsMovementId });
  const codes = lane === 'product'
    ? await reader.select({ id: biocharProducts.id, code: biocharProducts.code }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, bin.id)))
    : await reader.select({ id: productionRuns.id, code: productionRuns.code }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, bin.id)));
  const codeMap = new Map(codes.map(row => [row.id, row.code]));
  const runCodes = await reader.select({ id: productionRuns.id, code: productionRuns.code }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, input.facilityId)));
  const runMap = new Map(runCodes.map(row => [row.id, row.code]));
  const before = planOutputStock(layers, input.occurredAt, { kind: 'count', wetKg: 0 });
  let plan: ReturnType<typeof planOutputStock> | null = null;
  let blockingMessage: string | null = null;
  const request: OutputStockRequest = input.kind === 'count'
    ? { kind: 'count', wetKg: input.wetMassKg, moisturePercent: input.moisturePercent ?? undefined }
    : sources ? { kind: 'ordered', wetKg: input.wetMassKg, sources }
      : { kind: 'wet', wetKg: input.wetMassKg, moisturePercent: input.moisturePercent! };
  try {
    plan = planOutputStock(planningLayers, input.occurredAt, request, policy);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // A draw through every sub-bin the bin holds is short of the bin, not of its last sub-bin.
    const held = planningLayers.filter(l => l.placedAt <= input.occurredAt && l.remainingSolidsKg && l.remainingSolidsKg.numerator > BigInt(0));
    const drawsWholeBin = Boolean(sources) && held.every(l => sources!.some(s => s.layerId === l.id));
    blockingMessage = (drawsWholeBin && error instanceof SubBinOverdrawError ? null : subBinMessage(error, codeMap)) ?? operatorStockMessage(error instanceof SubBinOverdrawError ? 'Insufficient exact dry solids' : error.message);
  }
  if (correction && plan) await prepareOutputCorrection(ctx, input, state.layers, reader, plan.allocations.map(a => a.layerId));
  const beforeDryKg = Number(kilograms(layers.filter(l => l.placedAt <= input.occurredAt).reduce((sum, l) => sum + grams(l.remainingDryBiocharKg), BigInt(0))));
  const beforeSolidsKg = rationalNumber(before.expectedSolidsKg);
  const removedSolids = plan?.allocations.reduce((sum, a) => add(sum, a.solidsKg), rational(BigInt(0))) ?? rational(BigInt(0));
  const afterSolidsKg = beforeSolidsKg - rationalNumber(removedSolids);
  // A draw from several sub-bins has no single reading; its overall moisture is 1 − solids ÷ wet.
  const moisture = sources ? (plan ? (1 - rationalNumber(removedSolids) / input.wetMassKg) * PERCENT_SCALE : null) : input.moisturePercent ?? null;
  // A reading resets the estimate of the sub-bin it was taken from; the wet
  // estimates before and after come from each layer's latest reading.
  const bases = await getLayerMoistureBases(ctx, bin, layers, reader, { ignoreMovementId: input.correctsMovementId });
  // Every layer after the draw, not only the planning subset a reduced loss restores: a pile reading describes them all.
  const afterLayers = layers.map(l => plan?.remainingLayers.find(a => a.id === l.id) ?? l);
  const readings = plan ? planReadings(request, { allocations: plan.allocations, remainingLayers: afterLayers }, input.occurredAt, policy) : [];
  const drawnBases = plan ? bases.map(basis => ({ ...basis, remainingSolidsKg: plan!.remainingLayers.find(l => l.id === basis.layerId)?.remainingSolidsKg ?? basis.remainingSolidsKg })) : bases;
  const nextSequence = (events.at(-1)?.sequence ?? BigInt(0)) + BigInt(1);
  const afterBases = withReadings(drawnBases, readings, input.occurredAt, nextSequence);
  const estimateBefore = estimateStock(bases, input.occurredAt);
  const estimateAfter = estimateStock(afterBases, input.occurredAt);
  // A mix reading describes the whole pile, so the change names the pile, not each batch.
  const moistureReset = resetChange(drawnBases, afterBases, readings, input.occurredAt, codeMap, stockMode === 'mix' ? mixPileName(bin.name) : null);
  const layerViews = (viewLayers: OutputStockLayer[], viewBases: LayerMoistureBasis[]) => viewLayers.filter(l => l.placedAt <= input.occurredAt).sort((a, b) => a.placedAt.localeCompare(b.placedAt) || (a.postingSequence < b.postingSequence ? -1 : 1)).map(l => ({
    layerId: l.id, code: codeMap.get(l.id) ?? l.id, dryMassKg: Number(l.remainingDryBiocharKg),
    wetMassKg: layerWetKg(viewBases, l, input.occurredAt),
    runs: l.runs.map(r => ({ productionRunId: r.productionRunId, code: runMap.get(r.productionRunId) ?? r.productionRunId, dryMassKg: Number(r.remainingDryKg) })),
  }));
  // Rule 19: a backdated mix entry leaves later removals' saved shares alone; name them, at facility time.
  const calculatedWithout = async () => {
    // Any entry, even one timed while the bin was split, changes the pile later mix removals drew from.
    const later = laterMixRemovals(events, input, bin.stockMode, modeChanges);
    if (!later.length) return [];
    const zone = await getOutputStockFacilityTimezone(ctx, input.facilityId, reader);
    return later.map(e => ({ id: e.id, occurredAt: e.occurredAt, label: `${e.label} (${formatFacilityDateTime(e.occurredAt, zone)})` }));
  };
  const [formulation] = bin.formulationId ? await reader.select({ name: formulations.name }).from(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, bin.formulationId))) : [];
  const preview: OutputStockPreview = {
    basisFingerprint, storageLocationId: bin.id, binName: bin.name, binCode: bin.code, formulationName: formulation?.name ?? null, lane, beforeDryKg,
    beforeAllocations: layerViews(layers, bases), afterAllocations: layerViews(afterLayers, afterBases),
    afterDryKg: beforeDryKg - Number(plan?.drawnDryKg ?? 0), beforeSolidsKg, afterSolidsKg,
    removedDryKg: Number(plan?.drawnDryKg ?? 0), removedWetKg: input.kind === 'count' ? null : input.wetMassKg,
    movementMoisturePercent: moisture, beforeEstimatedWetKg: estimateBefore.wetKg,
    afterEstimatedWetKg: plan ? estimateAfter.wetKg : estimateBefore.wetKg,
    moistureEstimate: { moisturePercent: estimateBefore.moisturePercent, wetKg: estimateBefore.wetKg, basis: estimateBefore.basis },
    moistureReset, stockMode,
    calculatedWithout: await calculatedWithout(),
    discrepancySolidsKg: plan ? rationalNumber(plan.discrepancySolidsKg) : 0,
    allocations: plan?.allocations.map(a => ({ layerId: a.layerId, code: codeMap.get(a.layerId) ?? a.layerId,
      dryMassKg: Number(a.dryKg), wetMassKg: a.wetShareKg ? rationalNumber(a.wetShareKg) : null,
      runs: a.runs.map(r => ({ productionRunId: r.productionRunId, code: runMap.get(r.productionRunId) ?? r.productionRunId, dryMassKg: Number(r.dryKg) })) })) ?? [], blockingMessage,
  };
  return { input, bin, lane, layers, plan, preview, correction, sources, readings, policy };
}

const REMOVAL_KINDS: ReadonlySet<string> = new Set(['delivery', 'loss', 'count', 'production_draw', 'product_draw', 'replacement']);
const CODED_REASON_KINDS: ReadonlySet<string> = new Set(['delivery', 'production_draw']);

/**
 * Posted mix-pile removals timed after this entry. Their saved shares were
 * calculated without it and stay as posted (ADR 0030); the operator is told
 * which ones. A reversed removal and the entry being corrected no longer count.
 */
function laterMixRemovals(events: readonly { id: string; kind: string | null; occurredAt: Date | null; reason: string; correctsMovementId: string | null }[],
  input: OutputStockPreviewInput, mode: OutputStockMode, changes: readonly StockModeChange[]): { id: string; label: string; occurredAt: string }[] {
  const reversed = new Set(events.filter(e => e.kind === 'reversal').map(e => e.correctsMovementId));
  return events.filter(e => e.kind && REMOVAL_KINDS.has(e.kind) && e.occurredAt && e.id !== input.correctsMovementId && !reversed.has(e.id))
    .map(e => ({ id: e.id, kind: e.kind!, reason: e.reason, occurredAt: e.occurredAt!.toISOString() }))
    .filter(e => e.occurredAt > input.occurredAt && stockModeAt(mode, changes, e.occurredAt) === 'mix')
    // Deliveries and product draws name their record ("Delivery D-0012"); other reasons are free text.
    .map(e => ({ id: e.id, label: CODED_REASON_KINDS.has(e.kind) && e.reason ? e.reason : outputStockEventLabel(e.kind), occurredAt: e.occurredAt }));
}

/** One layer's wet estimate at its latest moisture, or null when it has none. */
function layerWetKg(bases: readonly LayerMoistureBasis[], layer: OutputStockLayer, at: string): number | null {
  const basis = bases.find(b => b.layerId === layer.id);
  return basis ? estimateStock([basis], at).wetKg : null;
}

/**
 * The stock a movement's readings reset, before and after: the same remaining
 * solids at their previous estimate, then at the reading. Null when nothing
 * the readings describe is left in the bin, or when the reading matches the
 * estimate as shown: the reading is still saved, but an unchanged pair is noise.
 */
function resetChange(drawn: readonly LayerMoistureBasis[], after: readonly LayerMoistureBasis[], readings: readonly PlannedReading[], at: string, codes: Map<string, string>, pileName: string | null): OutputStockPreview['moistureReset'] {
  const ids = new Set(readings.map(reading => reading.layerId));
  if (!ids.size) return null;
  const previous = estimateStock(drawn.filter(b => ids.has(b.layerId)), at);
  const next = estimateStock(after.filter(b => ids.has(b.layerId)), at);
  if (previous.moisturePercent !== null && formatMoisturePercent(previous.moisturePercent) === formatMoisturePercent(next.moisturePercent)) return null;
  return {
    layerCodes: pileName ? [pileName] : [...ids].map(id => codes.get(id) ?? id),
    before: { moisturePercent: previous.moisturePercent, wetKg: previous.wetKg },
    after: { moisturePercent: next.moisturePercent, wetKg: next.wetKg },
  };
}

const STORED_PERCENT_PRECISION = 1 / STORED_PERCENT_INPUT_STEP;

/** A derived overall moisture at the precision a stored percent keeps. */
export function storedOverallMoisture(preview: OutputStockPreview): number | null {
  const moisture = preview.movementMoisturePercent;
  return moisture == null ? null : Math.round(moisture * STORED_PERCENT_PRECISION) / STORED_PERCENT_PRECISION;
}

/** The moisture a posting saves: the reading, or a split draw's overall 1 − solids ÷ wet across its sub-bins. */
export function postedMoisturePercent(prepared: { sources?: unknown; input: { moisturePercent?: number | null }; preview: OutputStockPreview }): number | null {
  return prepared.sources ? storedOverallMoisture(prepared.preview) : prepared.input.moisturePercent ?? null;
}

/** The order and readings an ordered draw was posted with, or undefined for a FIFO draw. */
function savedSources(inputSnapshot: Record<string, unknown> | null) {
  const parsed = orderedSourcesSchema.safeParse(inputSnapshot?.sources);
  return parsed.success ? parsed.data : undefined;
}

/** Split-bin refusals name the sub-bin the operator has to act on. */
function subBinMessage(error: RangeError, codes: Map<string, string>): string | null {
  if (error instanceof UntickSubBinError) {
    const code = codes.get(error.layerId) ?? error.layerId;
    return `This load is used up before it reaches ${code}. Untick ${code}.`;
  }
  if (error instanceof SubBinOverdrawError) {
    const code = codes.get(error.layerId) ?? error.layerId;
    return `This load holds more dry solids than ${code} holds by the records. Reconcile stock first.`;
  }
  return null;
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
    // Only the current balance is shown. A correction that replays saved
    // readings carries none of its own, so its balance is read as a zero count.
    const balanceInput = input.moisturePercent == null ? { ...input, sources: undefined, kind: 'count' as const, wetMassKg: 0 } : { ...input, sources: undefined };
    const preview = (await prepareOutputStock(ctx, { ...balanceInput, correctsMovementId: undefined })).preview;
    return { ...preview, discrepancySolidsKg: 0, moistureReset: null, afterDryKg: preview.beforeDryKg, afterSolidsKg: preview.beforeSolidsKg, afterEstimatedWetKg: preview.beforeEstimatedWetKg, afterAllocations: preview.beforeAllocations, allocations: [], removedDryKg: 0, removedWetKg: null, blockingMessage: `${error.message} Replacement balances are unavailable until this dependency is resolved.`, blockers: error.blockers ?? [error.conflict] };
  }
}
export async function getMatchingOutputBins(ctx: OrgContext, input: { facilityId: string; formulationId: string }): Promise<MatchingOutputBin[]> {
  requireOrgScope(ctx);
  const [formulation] = await db.select({ id: formulations.id }).from(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, input.formulationId)));
  if (!formulation) throw new SafeError('Formulation not found');
  const bins = await db.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.facilityId, input.facilityId), eq(storageLocations.type, 'product_bin'), eq(storageLocations.formulationId, input.formulationId), isNull(storageLocations.archivedAt))).orderBy(asc(storageLocations.code));
  // Orders carry no departure moisture, so wet availability is the bin's
  // estimate at each batch's latest reading, as the bin selectors show it.
  // A bin whose layers do not resolve reads null instead of failing the list.
  return Promise.all(bins.map(async bin => {
    const { dryMassKg, estimatedWetMassKg } = await getOutputBinStockView(ctx, bin.id);
    return { id: bin.id, code: bin.code, name: bin.name, dryMassKg, estimatedWetMassKg };
  }));
}
export { getOutputStockHistory } from './output-stock-history';
