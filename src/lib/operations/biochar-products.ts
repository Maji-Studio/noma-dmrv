import { randomUUID } from "node:crypto";
import { createBiocharProductInTransaction, findCommittedBiocharProduct, type BiocharProductRequest, type CreatedBiocharProduct } from "@/data-access/biochar-product-create";
import { readProductFacility, resolveProductComposition } from "@/data-access/biochar-product-input";
import { updateBiocharProductInTransaction } from "@/data-access/biochar-product-update";
import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { toBiocharProductRecord } from "@/data-access/biochar-product-record";
import { biocharProducts, type BiocharProductRecord } from "@/db/schema";
import { deriveBlendMassKg } from "@/lib/biochar-composition/composition";
import { withOutputStockErrors } from "@/lib/output-stock-domain-errors";
import { makeBiocharProductInput, updateBiocharProductInput, type MakeBiocharProductInput } from "@/schemas/biochar-product-input";
import { hasLocalEventInstant, resolveEventInstant } from "./event-times";
import { GENERATED_MOVEMENT_KEY_PREFIX } from "./output-stock";
import type { OperationEffect } from "@/lib/operation-effect";
import type { Operation, OperationScope } from "./runner";

const AUTO_CODE_COUNT = 1;
const PRODUCT_ENTITY = "biocharProduct";

/** Preconditions, request keys and the target describe how a write was sent, not what it changed. */
const NOT_CHANGES: ReadonlySet<string> = new Set(["basisFingerprint", "idempotencyKey", "expectedVersion", "biocharProductId"]);

function changedFields(input: object): string[] {
  return Object.entries(input).filter(([key, value]) => value !== undefined && !NOT_CHANGES.has(key)).map(([key]) => key).sort();
}

/** Operator facts used for stock planning and replay before locked recipe enrichment. */
function ingredientFacts(ingredient: MakeBiocharProductInput["ingredients"][number]) {
  return {
    formulationIngredientId: ingredient.formulationIngredientId, storageLocationId: ingredient.storageLocationId,
    massKg: ingredient.wetMassKg, moistureContentPercent: ingredient.moisturePercent ?? null,
  };
}

/** The create a product request stands for, without the generated code or the recipe's composition. */
function productRequest(input: MakeBiocharProductInput, placedAt: string, idempotencyKey: string): Omit<BiocharProductRequest, "composition"> {
  // The stored blend is derived exactly as the form derives it (decision 52).
  const massKg = deriveBlendMassKg(input.biocharWetMassKg, input.ingredients.map((ingredient) => ({ massKg: ingredient.wetMassKg }))) ?? input.biocharWetMassKg;
  return {
    facilityId: input.facilityId, formulationId: input.formulationId, placedAt, idempotencyKey,
    basisFingerprint: input.basisFingerprint, status: input.status,
    sourceBiocharStorageLocationId: input.sourceBiocharStorageLocationId, storageLocationId: input.storageLocationId,
    massKg, moistureContentPercent: input.biocharMoisturePercent ?? null, sources: input.sources,
    densityKgM3: input.densityKgM3 ?? null, waterAddedKg: input.waterAddedKg,
  };
}

/**
 * The product a resubmitted form already committed under its request key,
 * looked up from the operator's facts before the live facility and recipe
 * checks, so a line added or removed, or the facility archived, since the
 * first submit cannot refuse the retry. A facility-local placement needs the
 * facility's zone, so it takes the ordinary path.
 */
async function findCommittedProduct({ ctx, tx }: OperationScope, input: MakeBiocharProductInput) {
  if (!input.idempotencyKey || hasLocalEventInstant(input.placedAt)) return undefined;
  const placedAt = resolveEventInstant(input.placedAt, undefined, ["placedAt"]).toISOString();
  const committed = await findCommittedBiocharProduct(ctx, tx, {
    ...productRequest(input, placedAt, input.idempotencyKey), composition: { ingredients: input.ingredients.map(ingredientFacts) },
  });
  return committed && { ...committed, product: toBiocharProductRecord(committed.product) };
}

/** The audit effects of a created and an updated product; adapters that publish a different output reuse them. */
export function describeMadeProduct(input: object, product: { id: string; version: number }): OperationEffect {
  return {
    outcome: "created", entityType: PRODUCT_ENTITY, entityIds: [product.id],
    versionBefore: null, versionAfter: product.version, changedFields: changedFields(input),
  };
}

export function describeUpdatedProduct(input: object, product: { id: string; version: number }, versionBefore: number): OperationEffect {
  return {
    outcome: "updated", entityType: PRODUCT_ENTITY, entityIds: [product.id],
    versionBefore, versionAfter: product.version, changedFields: changedFields(input),
  };
}

export const makeBiocharProduct: Operation<typeof makeBiocharProductInput, CreatedBiocharProduct<BiocharProductRecord>> = {
  id: "make_biochar_product",
  input: makeBiocharProductInput,
  supportsDryRun: true,
  describe: (input, output) => describeMadeProduct(input, output.product),
  execute: (scope, input) => withOutputStockErrors(async () => {
    const { ctx, tx, snapshotStock, activity } = scope;
    const committed = await findCommittedProduct(scope, input);
    if (committed) {
      activity.skip();
      return committed;
    }
    // The facility supplies the zone a facility-local placement is read in.
    const facility = await readProductFacility(ctx, tx, input.facilityId);
    const composition = { ingredients: input.ingredients.map(ingredientFacts) };
    const placedAt = resolveEventInstant(input.placedAt, facility.timeZone, ["placedAt"]).toISOString();
    // A fresh movement key per execution never double-posts; see GENERATED_MOVEMENT_KEY_PREFIX.
    const idempotencyKey = input.idempotencyKey ?? `${GENERATED_MOVEMENT_KEY_PREFIX}${randomUUID()}`;
    const request = productRequest(input, placedAt, idempotencyKey);
    // Each code attempt runs the whole create, posting seam included, in its own savepoint.
    const created = await withAutoCodes(ctx, tx, "BP", biocharProducts, biocharProducts.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createBiocharProductInTransaction(ctx, savepoint, { code, ...request, composition }, { snapshotStock, onReplay: activity.skip, resolveComposition: lockedTx => resolveProductComposition(ctx, lockedTx, input.formulationId, composition) }),
      CODE_CONFLICT_MESSAGES.biocharProduct);
    activity.link({ facilityId: created.product.facilityId, productionRunId: created.product.linkedProductionRunId ?? undefined });
    return { ...created, product: toBiocharProductRecord(created.product) };
  }, {
    // A short sub-bin points at its entry in `sources`; a short source bin at the biochar mass.
    shortage: (detail) => {
      const index = detail.layerId ? input.sources?.findIndex((source) => source.layerId === detail.layerId) ?? -1 : -1;
      return index >= 0 ? ["sources", index] : ["biocharWetMassKg"];
    },
    // A short ingredient bin points at the first ingredient drawn from it.
    ingredient: (detail) => {
      const index = input.ingredients.findIndex((ingredient) => ingredient.storageLocationId === detail.storageLocationId);
      return index >= 0 ? ["ingredients", index, "wetMassKg"] : ["ingredients"];
    },
  }),
};

export const updateBiocharProduct: Operation<typeof updateBiocharProductInput, BiocharProductRecord> = {
  id: "update_biochar_product",
  input: updateBiocharProductInput,
  supportsDryRun: true,
  describe: (input, output) => describeUpdatedProduct(input, output, input.expectedVersion),
  execute: ({ ctx, tx, activity }, { biocharProductId, ...changes }) => withOutputStockErrors(async () => {
    const product = toBiocharProductRecord(await updateBiocharProductInTransaction(ctx, tx, biocharProductId, changes));
    activity.link({ facilityId: product.facilityId, productionRunId: product.linkedProductionRunId ?? undefined });
    return product;
  }),
};
