import { createHash } from 'node:crypto';
import { allocateApplicationShares, massGrams, splitGrams } from '../data-access/delivery-allocation-math';
import { KG_PER_TONNE } from '../lib/calculations/unit-conversions';
import { grams, kilograms, planOutputStock, storeRational, type OutputStockLayer } from '../lib/output-stock';
import type { DbTransaction } from '.';
import { DEC_ORG_ID } from './org-defaults';
import * as schema from './schema';
import { curatedBiocharChainMasses, curatedProductSourceAllocations, demoId, demoTimestamps, ids } from './seed-demo-facts';

const GRAMS_PER_KG = 1000;
const PERCENT = 100;
const MOISTURE_DECIMALS = 6;
const INGREDIENT_ID_BASE = 3300;
const MOVEMENT_ID_BASE = 3400;
const ALLOCATION_ID_BASE = 3410;
const DERIVATION_REASON = 'Synthetic demo mass balance: ingredient solids equal recorded finished-blend solids minus frozen source biochar solids. Ingredient water is distributed by recipe wet mass; this is a derived demo basis, not an intake or moisture reading.';

export const demoIngredientRecipes = [
  { id: demoId(INGREDIENT_ID_BASE), formulationId: ids.formulationStandard, feedstockTypeId: ids.feedstockCowCompost, ratio: 0.6, sortOrder: 0, name: 'Cow Manure Compost' },
  { id: demoId(INGREDIENT_ID_BASE + 1), formulationId: ids.formulationPremium, feedstockTypeId: ids.feedstockGreenCompost, ratio: 0.2, sortOrder: 0, name: 'Green Waste Compost' },
  { id: demoId(INGREDIENT_ID_BASE + 2), formulationId: ids.formulationPremium, feedstockTypeId: ids.feedstockRockDust, ratio: 0.1, sortOrder: 1, name: 'Rock Dust' },
  { id: demoId(INGREDIENT_ID_BASE + 3), formulationId: ids.formulationOrganic, feedstockTypeId: ids.feedstockVermicompost, ratio: 0.4, sortOrder: 0, name: 'Vermicompost' },
  { id: demoId(INGREDIENT_ID_BASE + 4), formulationId: ids.formulationOrganic, feedstockTypeId: ids.feedstockAgriculturalLime, ratio: 0.1, sortOrder: 1, name: 'Agricultural Lime' },
] as const;

const chains = [
  { ...curatedBiocharChainMasses.product1, formulationId: ids.formulationStandard, storageLocationId: ids.storageProdMoshi, moisturePercent: 5.5, deliveryId: ids.delivery1, deliveryDate: demoTimestamps.delivery1Date, applicationId: ids.application1 },
  { ...curatedBiocharChainMasses.product2, formulationId: ids.formulationPremium, storageLocationId: ids.storageProdPremium, moisturePercent: 4.8, deliveryId: ids.delivery2, deliveryDate: demoTimestamps.delivery2Date, applicationId: ids.application2 },
  { ...curatedBiocharChainMasses.product3, formulationId: ids.formulationOrganic, storageLocationId: ids.storageProdOrganic, moisturePercent: 6, deliveryId: ids.delivery3, deliveryDate: demoTimestamps.delivery3Date, applicationId: ids.application3 },
];

/** Pure, deterministic demo facts. No connection, intake lookup, or environment loading. */
export function buildDemoOutputStock(postingSequences?: ReadonlyMap<string, bigint>) {
  return chains.map((chain, index) => {
    const sources = curatedProductSourceAllocations.filter(s => s.biocharProductId === chain.productId);
    const sourceGrams = sources.reduce((sum, s) => sum + grams(s.allocatedDryMassKg), BigInt(0));
    const finishedSolidsGrams = massGrams(chain.productWetKg * (1 - chain.moisturePercent / PERCENT));
    const recipes = demoIngredientRecipes.filter(r => r.formulationId === chain.formulationId);
    const wetGrams = recipes.map(r => massGrams(chain.productWetKg * r.ratio));
    const dryGrams = splitGrams(finishedSolidsGrams - Number(sourceGrams), wetGrams);
    const ingredients = recipes.map((recipe, i) => {
      const moisturePercentUsed = Number(((1 - dryGrams[i] / wetGrams[i]) * PERCENT).toFixed(MOISTURE_DECIMALS));
      if (moisturePercentUsed < 0 || moisturePercentUsed >= PERCENT ||
        Math.round(wetGrams[i] * (1 - moisturePercentUsed / PERCENT)) !== dryGrams[i]) {
        throw new Error('Demo ingredient basis does not conserve solids');
      }
      return {
        organizationId: DEC_ORG_ID, biocharProductId: chain.productId,
        formulationIngredientId: recipe.id, sourceStorageLocationId: null,
        wetMassKg: kilograms(BigInt(wetGrams[i])), drySolidsKg: kilograms(BigInt(dryGrams[i])),
        moisturePercentUsed, moistureSource: 'operator_override' as const,
        moistureSourceSnapshot: { kind: 'synthetic_demo_mass_balance', reason: DERIVATION_REASON,
          productWetKg: chain.productWetKg, productMoisturePercent: chain.moisturePercent,
          sourceDryBiocharKg: kilograms(sourceGrams), recipeWetRatio: recipe.ratio },
      };
    });
    const ingredientDrySolidsKg = kilograms(BigInt(dryGrams.reduce((sum, n) => sum + n, 0)));
    const layer: OutputStockLayer = {
      id: chain.productId, physicalDate: demoTimestamps.run3End.toISOString().slice(0, 10),
      postingSequence: postingSequences?.get(chain.productId) ?? BigInt(index + 1), establishedDryBiocharKg: kilograms(sourceGrams),
      remainingDryBiocharKg: kilograms(sourceGrams), ingredientDrySolidsKg,
      runs: sources.map(s => ({ productionRunId: s.productionRunId, establishedDryKg: s.allocatedDryMassKg, remainingDryKg: s.allocatedDryMassKg })),
    };
    const physicalDate = chain.deliveryDate.toISOString().slice(0, 10);
    const plan = planOutputStock([layer], physicalDate, { kind: 'wet', wetKg: chain.deliveredWetKg, moisturePercent: chain.moisturePercent });
    if (grams(plan.drawnDryKg) !== grams(chain.deliveredDryKg)) throw new Error('Demo delivery does not conserve dry biochar');
    const effect = plan.allocations[0];
    const movementId = demoId(MOVEMENT_ID_BASE + index);
    const allocationId = demoId(ALLOCATION_ID_BASE + index);
    const inputSnapshot = { kind: 'delivery', storageLocationId: chain.storageLocationId, facilityId: ids.facilityMoshi,
      physicalDate, wetMassKg: chain.deliveredWetKg, moisturePercent: chain.moisturePercent, deliveryId: chain.deliveryId,
      provenance: 'curated_demo', sourceAllocationMethod: 'mass_weighted' };
    const movement: typeof schema.binMovements.$inferInsert = {
      id: movementId, organizationId: DEC_ORG_ID, storageLocationId: chain.storageLocationId,
      lane: 'product', movementType: 'adjustment', outputKind: 'delivery', physicalDate,
      massDeltaKg: -Number(plan.drawnDryKg), outputDryDeltaKg: kilograms(-grams(plan.drawnDryKg)),
      balanceBeforeDryKg: kilograms(sourceGrams), balanceAfterDryKg: kilograms(sourceGrams - grams(plan.drawnDryKg)),
      reason: 'Curated demo delivery from a product with frozen mass-weighted source provenance.',
      idempotencyKey: `demo-delivery-${chain.deliveryId}`,
      basisFingerprint: createHash('sha256').update(JSON.stringify(inputSnapshot)).digest('hex'), inputSnapshot,
    };
    const allocation: typeof schema.outputStockAllocations.$inferInsert = {
      id: allocationId, organizationId: DEC_ORG_ID, movementId, sourceStorageLocationId: chain.storageLocationId,
      biocharProductId: chain.productId, deliveryId: chain.deliveryId, dryMassKg: effect.dryKg,
      wetMassKg: kilograms(grams(chain.deliveredWetKg)),
      basisSnapshot: { solidsKg: storeRational(effect.solidsKg), wetShareKg: storeRational(effect.wetShareKg!),
        establishedDryBiocharKg: layer.establishedDryBiocharKg, ingredientDrySolidsKg,
        physicalDate: layer.physicalDate, postingSequence: String(layer.postingSequence), code: `BP-26-00${index + 1}` },
    };
    const runs = effect.runs.map(r => ({ organizationId: DEC_ORG_ID, allocationId, productionRunId: r.productionRunId, dryMassKg: r.dryKg }));
    // Match the delivery projection: wet shares are apportioned from saved dry run shares.
    const runWetGrams = splitGrams(massGrams(chain.deliveredWetKg), runs.map(r => Number(grams(r.dryMassKg))));
    const saved = runs.map((r, i) => ({ deliveryId: chain.deliveryId, biocharProductId: chain.productId,
      productionRunId: r.productionRunId, dryMassKg: Number(r.dryMassKg), wetMassKg: runWetGrams[i] / GRAMS_PER_KG }));
    const applications = allocateApplicationShares(saved, [], chain.appliedWetTons * KG_PER_TONNE, chain.appliedDryTons * KG_PER_TONNE)
      .map(share => ({ ...share, organizationId: DEC_ORG_ID, applicationId: chain.applicationId,
        wetMassKg: kilograms(grams(share.wetMassKg)), dryMassKg: kilograms(grams(share.dryMassKg)) }));
    const composition = { sourceAllocationMethod: 'mass_weighted', sourceBiocharMassKg: sources.reduce((sum, s) => sum + s.allocatedWetMassKg, 0),
      ingredients: ingredients.map((ingredient, i) => ({ formulationIngredientId: ingredient.formulationIngredientId,
        feedstockTypeId: recipes[i].feedstockTypeId, feedstockTypeName: recipes[i].name, ratio: recipes[i].ratio,
        massKg: Number(ingredient.wetMassKg), massDryKg: Number(ingredient.drySolidsKg),
        moistureContentPercent: ingredient.moisturePercentUsed, moistureSource: ingredient.moistureSource,
        moistureSourceSnapshot: ingredient.moistureSourceSnapshot, storageLocationId: null })) };
    return { chain, layer, ingredients, composition, movement, allocation, runs, applications, remainingLayers: plan.remainingLayers };
  });
}

// Bootstrap seam only: parents are inserted in this same demo transaction.
export async function seedDemoSavedOutputAllocations(tx: DbTransaction, postingSequences: ReadonlyMap<string, bigint>) {
  const facts = buildDemoOutputStock(postingSequences);
  await tx.insert(schema.productIngredientSnapshots).values(facts.flatMap(f => f.ingredients));
  await tx.insert(schema.binMovements).values(facts.map(f => f.movement));
  await tx.insert(schema.outputStockAllocations).values(facts.map(f => f.allocation));
  await tx.insert(schema.outputStockRunAllocations).values(facts.flatMap(f => f.runs));
  await tx.insert(schema.applicationOutputAllocations).values(facts.flatMap(f => f.applications));
}
