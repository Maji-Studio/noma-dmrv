import { db } from '@/db';
import { biocharProducts, facilities, formulations, outputStockAllocations, productIngredientSnapshots, storageLocations, type BiocharProduct } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { grams, kilograms } from '@/lib/output-stock';
import { and, eq, isNull } from 'drizzle-orm';
import { assertCompositionIngredientDrawsWithinStock, deriveCompositionSourceBiocharMassKg, getCompositionIngredientDraws, validateCompositionIngredientBins } from './biochar-product-composition';
import { insertBiocharProductSourceAllocations } from './biochar-product-source-allocations';
import { lockBinStocks } from './lock-bin-stocks';
import { revalidateProductStock } from './product-stock-preview';
import { findOutputRequest, lockOutputRequest, persistOutputStock } from './output-stock-post';
import { requireOrgScope } from './utils';

export interface CreateBiocharProductInput {
  code: string;
  facilityId: string;
  formulationId: string;
  placedAt: string;
  idempotencyKey: string;
  basisFingerprint: string;
  status?: 'draft' | 'testing' | 'ready' | 'sold';
  sourceBiocharStorageLocationId?: string | null;
  linkedProductionRunId?: string | null;
  storageLocationId?: string | null;
  massKg?: number | null;
  moistureContentPercent?: number | null;
  densityKgM3?: number | null;
  waterAddedKg?: number | null;
  composition?: Record<string, unknown>;
}
export async function createBiocharProduct(ctx: OrgContext, data: CreateBiocharProductInput): Promise<BiocharProduct> {
  requireOrgScope(ctx);
  if (!data.formulationId) throw new SafeError('Choose a formulation, including Pure biochar for an unblended product.');
  if (!data.sourceBiocharStorageLocationId || data.linkedProductionRunId) throw new SafeError('Choose a source biochar bin.');
  if (!data.storageLocationId) throw new SafeError('Choose a product bin.');
  if (data.massKg == null || !Number.isFinite(data.massKg) || data.massKg <= 0) throw new SafeError('Enter a positive wet mass.');
  if (data.waterAddedKg == null || !Number.isFinite(data.waterAddedKg) || data.waterAddedKg < 0) throw new SafeError('Water added must be zero or greater.');
  const wet = deriveCompositionSourceBiocharMassKg(data.massKg, data.composition);
  if (wet == null || wet <= 0) throw new SafeError('A product requires positive source biochar.');
  const input = { storageLocationId: data.sourceBiocharStorageLocationId, facilityId: data.facilityId, physicalDate: data.placedAt,
    kind: 'production_draw' as const, wetMassKg: wet, moisturePercent: data.moistureContentPercent,
    idempotencyKey: data.idempotencyKey, basisFingerprint: data.basisFingerprint, reason: `Product ${data.code}` };
  // Auto-generated display codes may change on a retried request; all operator facts must match.
  const payload = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'code'));
  return db.transaction(async tx => {
    await lockOutputRequest(ctx, tx, input.idempotencyKey);
    const existing = await findOutputRequest(ctx, tx, input, payload);
    if (existing) {
      const [product] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, String(existing.inputSnapshot?.targetBiocharProductId))));
      if (!product) throw new SafeError('The posted product could not be found.');
      return product;
    }
    await lockBinStocks(ctx, tx, [data.storageLocationId, input.storageLocationId, ...getCompositionIngredientDraws(data.composition).map(d => d.storageLocationId)]);
    const [facility] = await tx.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, data.facilityId), isNull(facilities.archivedAt))).for('share');
    if (!facility) throw new SafeError('Facility not found or archived');
    const [formulation] = await tx.select().from(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, data.formulationId))).for('share');
    if (!formulation) throw new SafeError('Formulation not found');
    const [bin] = await tx.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, data.storageLocationId!), eq(storageLocations.facilityId, data.facilityId), eq(storageLocations.type, 'product_bin'), isNull(storageLocations.archivedAt))).for('update');
    if (!bin || (bin.formulationId && bin.formulationId !== data.formulationId)) throw new SafeError('Choose a product bin for this formulation.');
    await validateCompositionIngredientBins(ctx, tx, data.composition, data.formulationId, data.facilityId);
    const productBasis = await revalidateProductStock(ctx, {
      facilityId: data.facilityId, formulationId: data.formulationId, placedAt: data.placedAt,
      sourceBiocharStorageLocationId: input.storageLocationId, storageLocationId: data.storageLocationId!,
      massKg: wet, moistureContentPercent: data.moistureContentPercent!, waterAddedKg: data.waterAddedKg!,
      ingredientBins: (data.composition?.ingredients ?? []) as Record<string, unknown>[],
    }, tx, data.basisFingerprint);
    const { composition, source: prepared } = productBasis;
    await assertCompositionIngredientDrawsWithinStock(ctx, tx, composition);
    if (!prepared.plan || prepared.preview.blockingMessage) throw new SafeError(prepared.preview.blockingMessage ?? 'Source stock is unavailable.');
    const firstLayer = prepared.layers.find(l => l.id === prepared.plan!.allocations[0].layerId)!;
    const [product] = await tx.insert(biocharProducts).values({ organizationId: ctx.organizationId, code: data.code, facilityId: data.facilityId,
      formulationId: data.formulationId, biocharRatio: formulation.biocharRatio, placedAt: data.placedAt,
      productionDate: new Date(`${firstLayer.physicalDate}T00:00:00.000Z`), status: data.status ?? 'testing',
      sourceBiocharStorageLocationId: input.storageLocationId, linkedProductionRunId: prepared.plan.allocations.length === 1 ? firstLayer.id : null,
      storageLocationId: data.storageLocationId, massKg: data.massKg, moistureContentPercent: data.moistureContentPercent, densityKgM3: data.densityKgM3,
      waterAddedKg: data.waterAddedKg, composition }).returning();
    // Post before source snapshots, so the locked read cannot subtract the new product twice.
    const posted = await persistOutputStock(ctx, tx, { ...input, basisFingerprint: prepared.preview.basisFingerprint }, { targetBiocharProductId: product.id, payload });
    const effects = await tx.select().from(outputStockAllocations).where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.movementId, posted.movement.id)));
    await insertBiocharProductSourceAllocations(ctx, tx, { biocharProductId: product.id, sourceStorageLocationId: input.storageLocationId,
      allocations: prepared.preview.allocations.map(a => ({ productionRunId: a.layerId, producedAt: new Date(`${prepared.layers.find(l => l.id === a.layerId)!.physicalDate}T00:00:00.000Z`), allocatedWetMassKg: Number(effects.find(e => e.productionRunId === a.layerId)!.wetMassKg), allocatedDryMassKg: a.dryMassKg })) });
    for (const ingredient of (composition.ingredients ?? []) as Record<string, unknown>[]) {
      if (ingredient.massKg === 0) continue;
      const moisture = Number(ingredient.moistureContentPercent);
      await tx.insert(productIngredientSnapshots).values({ organizationId: ctx.organizationId, biocharProductId: product.id,
        formulationIngredientId: String(ingredient.formulationIngredientId), sourceStorageLocationId: typeof ingredient.storageLocationId === 'string' ? ingredient.storageLocationId : null,
        wetMassKg: kilograms(grams(Number(ingredient.massKg))), moisturePercentUsed: moisture,
        moistureSource: ingredient.moistureSource === 'weighted_remaining' ? 'weighted_remaining' : 'operator_override',
        moistureSourceSnapshot: ingredient.moistureSourceSnapshot as Record<string, unknown>, drySolidsKg: kilograms(grams(Number(ingredient.massDryKg))) });
    }
    if (!bin.formulationId) await tx.update(storageLocations).set({ formulationId: data.formulationId, updatedAt: new Date() }).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, bin.id)));
    return product;
  });
}
