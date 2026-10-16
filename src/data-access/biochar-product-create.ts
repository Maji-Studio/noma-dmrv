import { nextVersion } from "./row-version";
import { db, type DbTransaction } from '@/db';
import { biocharProducts, facilities, outputStockAllocations, productIngredientSnapshots, productionRuns, storageLocations, type BiocharProduct, type ProductIngredientSnapshot } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { lockFormulationReference } from './formulation-reference-guards';
import { grams, kilograms } from '@/lib/output-stock';
import { and, eq, isNull } from 'drizzle-orm';
import { assertCompositionIngredientDrawsWithinStock, deriveCompositionSourceBiocharMassKg, validateCompositionIngredientBins } from './biochar-product-composition';
import { resolveProductComposition } from './biochar-product-input';
import { insertBiocharProductSourceAllocations } from './biochar-product-source-allocations';
import { assertEventTimesNotFuture } from './future-event-time';
import { revalidateProductStock } from './product-stock-preview';
import { assertAdditionAfterSplit } from './output-bin-stock-mode';
import { blockedOutputStockError } from './output-stock-errors';
import { findPostedOutputRequest, withOutputStockPostingInTransaction, type OutputStockPostingOptions, type PostedOutputRequest } from './output-stock-post';
import { postedMoisturePercent } from './output-stock-operations';
import { requireOrgScope } from './utils';
import { productionRunDateExpr } from './production-runs/date-expr';

const BIOCHAR_MOISTURE_REQUIRED = 'Enter the measured biochar moisture.';
const INGREDIENT_REPLAY_FACTS = ['formulationIngredientId', 'storageLocationId', 'massKg', 'moistureContentPercent'] as const;
export const PRODUCT_FUTURE_TIME_MESSAGE = 'Placement time cannot be in the future. Enter a time at or before now.';

export interface CreateBiocharProductInput {
  code: string;
  facilityId: string;
  formulationId: string;
  placedAt: string;
  idempotencyKey: string;
  /** The product preview's basis. Without one the product draws current stock under the bin locks (decision 53). */
  basisFingerprint?: string;
  status?: 'draft' | 'testing' | 'ready' | 'sold';
  sourceBiocharStorageLocationId?: string | null;
  linkedProductionRunId?: string | null;
  storageLocationId?: string | null;
  /** The pre-water blend: biochar as weighed plus every recorded ingredient wet mass. */
  massKg?: number | null;
  moistureContentPercent?: number | null;
  /** Split biochar bins: the sub-bins drawn, in the order they were emptied, each with its reading. */
  sources?: { layerId: string; moisturePercent: number }[];
  densityKgM3?: number | null;
  waterAddedKg?: number | null;
  composition?: Record<string, unknown>;
}

export interface CreatedBiocharProduct<Product = BiocharProduct> {
  product: Product;
  /** The product's stock basis across its source, product and ingredient bins, before the write. */
  basisFingerprint: string;
}

export interface CreateBiocharProductOptions extends OutputStockPostingOptions {
  /** Injectable server clock for exact-boundary tests. */
  now?: Date;
  /** Operations supply only operator facts; resolve recipe metadata under its lock. */
  resolveComposition?: (tx: DbTransaction) => Promise<Record<string, unknown>>;
}

/** The facts an operator enters per ingredient; a retried request must repeat them exactly. */
function ingredientReplayFacts(ingredient: Record<string, unknown>) {
  return Object.fromEntries(INGREDIENT_REPLAY_FACTS.map((key) => [key, ingredient[key] ?? null]));
}

/** A create without its generated code. A lookup's composition needs only the operator's facts per line. */
export type BiocharProductRequest = Omit<CreateBiocharProductInput, 'code'>;

/**
 * What a product request key stands for. Auto-generated display codes may
 * change on a retried request; all operator facts must match. Composition
 * lines carry catalog names and ratios read at write time, so only the
 * operator's facts per line count.
 */
function productRequestPayload(data: BiocharProductRequest) {
  return { ...Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'code' && key !== 'composition')),
    ingredients: ((data.composition?.ingredients ?? []) as Record<string, unknown>[]).map(ingredientReplayFacts)
      // Recipe lines come back in no fixed order; the hash must not depend on it.
      .sort((a, b) => String(a.formulationIngredientId).localeCompare(String(b.formulationIngredientId))) };
}

async function replayPostedProduct(ctx: OrgContext, tx: DbTransaction, existing: PostedOutputRequest): Promise<CreatedBiocharProduct> {
  requireOrgScope(ctx);
  const [product] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, String(existing.inputSnapshot?.targetBiocharProductId))));
  if (!product) throw new SafeError('The posted product could not be found.');
  // Every output movement stores its basis (bin_movements check constraint).
  return { product, basisFingerprint: existing.basisFingerprint ?? '' };
}

/**
 * The product a request key already committed, or undefined, found under the
 * request lock from the operator's facts alone. A caller runs it before any
 * live recipe or facility check, so a retried create still replays after a
 * formulation line was added or removed or the facility was archived. A key
 * reused with different facts is a conflict, as in the posting seam.
 */
export async function findCommittedBiocharProduct(ctx: OrgContext, tx: DbTransaction, data: BiocharProductRequest): Promise<CreatedBiocharProduct | undefined> {
  requireOrgScope(ctx);
  if (!data.sourceBiocharStorageLocationId) return undefined;
  const existing = await findPostedOutputRequest(ctx, tx, { idempotencyKey: data.idempotencyKey, payload: productRequestPayload(data), storageLocationId: data.sourceBiocharStorageLocationId });
  return existing ? replayPostedProduct(ctx, tx, existing) : undefined;
}

/**
 * Creates a product inside the caller's transaction (the operation runner's,
 * or `createBiocharProduct`'s). A generated-code retry calls this again in a
 * fresh savepoint, so each attempt re-enters the posting seam, takes its own
 * locks and one snapshot of every bin, and plans on the stock it then sees.
 * A future placement is refused (decision 56); backdating stays allowed.
 */
export async function createBiocharProductInTransaction(ctx: OrgContext, tx: DbTransaction, data: CreateBiocharProductInput, options: CreateBiocharProductOptions = {}): Promise<CreatedBiocharProduct> {
  requireOrgScope(ctx);
  if (!data.formulationId) throw new SafeError('Choose a formulation, including Pure biochar for an unblended product.');
  if (!data.sourceBiocharStorageLocationId || data.linkedProductionRunId) throw new SafeError('Choose a source biochar bin.');
  if (!data.storageLocationId) throw new SafeError('Choose a product bin.');
  if (data.massKg == null || !Number.isFinite(data.massKg) || data.massKg <= 0) throw new SafeError('Enter a positive wet mass.');
  if (!data.sources?.length && (data.moistureContentPercent == null || !Number.isFinite(data.moistureContentPercent))) throw new SafeError(BIOCHAR_MOISTURE_REQUIRED);
  if (data.waterAddedKg == null || !Number.isFinite(data.waterAddedKg) || data.waterAddedKg < 0) throw new SafeError('Water added must be zero or greater.');
  assertEventTimesNotFuture({ placedAt: new Date(data.placedAt) }, { placedAt: PRODUCT_FUTURE_TIME_MESSAGE }, options.now ?? new Date());
  const wet = deriveCompositionSourceBiocharMassKg(data.massKg, data.composition);
  if (wet == null || wet <= 0) throw new SafeError('A product requires positive source biochar.');
  const productBinId = data.storageLocationId;
  const massKg = data.massKg;
  const waterAddedKg = data.waterAddedKg;
  const input = { storageLocationId: data.sourceBiocharStorageLocationId, facilityId: data.facilityId, occurredAt: data.placedAt,
    kind: 'production_draw' as const, wetMassKg: wet,
    ...(data.sources?.length ? { sources: data.sources } : { moisturePercent: data.moistureContentPercent }),
    idempotencyKey: data.idempotencyKey, reason: `Product ${data.code}` };
  const payload = productRequestPayload(data);
  // Bin identity comes from operator facts and does not need a recipe read.
  const ingredientFacts = (data.composition?.ingredients ?? []) as { storageLocationId?: string | null; massKg?: number | null }[];
  const additionalBinIds = [productBinId, ...ingredientFacts.filter(line => (line.massKg ?? 0) > 0 && line.storageLocationId).map(line => line.storageLocationId)];
  return withOutputStockPostingInTransaction(ctx, tx, { input, payload, additionalBinIds, replay: (replayTx, existing) => replayPostedProduct(ctx, replayTx, existing), write: async (writeTx, post) => {
    const [facility] = await writeTx.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, data.facilityId), isNull(facilities.archivedAt))).for('share');
    if (!facility) throw new SafeError('Facility not found or archived');
    const formulation = await lockFormulationReference(ctx, writeTx, data.formulationId);
    const [bin] = await writeTx.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, productBinId), eq(storageLocations.facilityId, data.facilityId), eq(storageLocations.type, 'product_bin'), isNull(storageLocations.archivedAt))).for('update');
    if (!bin || (bin.formulationId && bin.formulationId !== data.formulationId)) throw new SafeError('Choose a product bin for this formulation.');
    await assertAdditionAfterSplit(ctx, writeTx, bin, new Date(data.placedAt));
    const compositionInput = options.resolveComposition ? await options.resolveComposition(writeTx) : data.composition;
    await validateCompositionIngredientBins(ctx, writeTx, compositionInput, data.formulationId, data.facilityId);
    const resolvedComposition = options.resolveComposition
      ? compositionInput!
      : await resolveProductComposition(ctx, writeTx, data.formulationId, compositionInput);
    const productBasis = await revalidateProductStock(ctx, {
      facilityId: data.facilityId, formulationId: data.formulationId, placedAt: data.placedAt,
      sourceBiocharStorageLocationId: input.storageLocationId, storageLocationId: productBinId,
      massKg: wet, moistureContentPercent: data.moistureContentPercent ?? undefined, sources: data.sources, waterAddedKg: data.waterAddedKg!,
      ingredientBins: (resolvedComposition.ingredients ?? []) as Record<string, unknown>[],
    }, writeTx, data.basisFingerprint);
    const { composition, source: prepared } = productBasis;
    // A short ingredient bin is a typed wet-stock shortage; a short source bin a typed solids shortage.
    await assertCompositionIngredientDrawsWithinStock(ctx, writeTx, composition);
    if (!prepared.plan || prepared.preview.blockingMessage) throw blockedOutputStockError(prepared.blocking, prepared.preview.blockingMessage ?? 'Source stock is unavailable.');
    // The production date is the oldest lot drawn, whatever order the operator emptied them in.
    const drawnLayers = prepared.plan.allocations.map(a => prepared.layers.find(l => l.id === a.layerId)!);
    const firstLayer = drawnLayers.reduce((oldest, layer) => layer.placedAt < oldest.placedAt ? layer : oldest);
    const [sourceRun] = await writeTx.select({ date: productionRunDateExpr() }).from(productionRuns).where(and(
      eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, data.facilityId), eq(productionRuns.id, firstLayer.id)));
    if (!sourceRun) throw new SafeError('Source production run not found.');
    const moistureContentPercent = postedMoisturePercent(prepared);
    if (moistureContentPercent == null) throw new SafeError(BIOCHAR_MOISTURE_REQUIRED);
    const [product] = await writeTx.insert(biocharProducts).values({ organizationId: ctx.organizationId, code: data.code, facilityId: data.facilityId,
      formulationId: data.formulationId, biocharRatio: formulation.biocharRatio, placedAt: new Date(data.placedAt),
      productionDate: sourceRun.date, status: data.status ?? 'testing',
      sourceBiocharStorageLocationId: input.storageLocationId, linkedProductionRunId: prepared.plan.allocations.length === 1 ? firstLayer.id : null,
      // A split draw's biochar moisture is its overall 1 − solids ÷ wet across the sub-bins read.
      storageLocationId: productBinId, massKg, moistureContentPercent, densityKgM3: data.densityKgM3,
      waterAddedKg, composition }).returning();
    // Post before source snapshots, so the locked read cannot subtract the new
    // product twice. The source plan is checked against its own basis; the
    // movement records the product-wide basis a dry run returned.
    const posted = await post({ targetBiocharProductId: product.id, basisFingerprint: prepared.preview.basisFingerprint, recordedBasisFingerprint: productBasis.basisFingerprint });
    const effects = await writeTx.select().from(outputStockAllocations).where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.movementId, posted.movement.id)));
    await insertBiocharProductSourceAllocations(ctx, writeTx, { biocharProductId: product.id, sourceStorageLocationId: input.storageLocationId,
      allocations: prepared.preview.allocations.map(a => ({ productionRunId: a.layerId, producedAt: new Date(prepared.layers.find(l => l.id === a.layerId)!.placedAt), allocatedWetMassKg: Number(effects.find(e => e.productionRunId === a.layerId)!.wetMassKg), allocatedDryMassKg: a.dryMassKg })) });
    for (const ingredient of (composition.ingredients ?? []) as Record<string, unknown>[]) {
      if (ingredient.massKg === 0) continue;
      const moisture = Number(ingredient.moistureContentPercent);
      await writeTx.insert(productIngredientSnapshots).values({ organizationId: ctx.organizationId, biocharProductId: product.id,
        formulationIngredientId: String(ingredient.formulationIngredientId), sourceStorageLocationId: typeof ingredient.storageLocationId === 'string' ? ingredient.storageLocationId : null,
        wetMassKg: kilograms(grams(Number(ingredient.massKg))), moisturePercentUsed: moisture,
        moistureEstimate: (ingredient.moistureEstimate ?? null) as ProductIngredientSnapshot['moistureEstimate'], drySolidsKg: kilograms(grams(Number(ingredient.massDryKg))) });
    }
    if (!bin.formulationId) await writeTx.update(storageLocations).set({ version: nextVersion(storageLocations.version), formulationId: data.formulationId, updatedAt: new Date() }).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, bin.id)));
    return { product, basisFingerprint: productBasis.basisFingerprint };
  } }, { snapshotStock: options.snapshotStock, onReplay: options.onReplay });
}

/** `createBiocharProductInTransaction` in a transaction of its own, without the operation runner. */
export async function createBiocharProduct(ctx: OrgContext, data: CreateBiocharProductInput, options: Pick<CreateBiocharProductOptions, 'now'> = {}): Promise<BiocharProduct> {
  requireOrgScope(ctx);
  const created = await db.transaction(tx => createBiocharProductInTransaction(ctx, tx, data, options));
  return created.product;
}
