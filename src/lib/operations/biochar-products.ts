import { randomUUID } from "node:crypto";
import { createBiocharProductInTransaction, findCommittedBiocharProduct, type BiocharProductRequest, type CreatedBiocharProduct } from "@/data-access/biochar-product-create";
import { readProductFacility, readProductFormulationLines, type ProductFormulationLine } from "@/data-access/biochar-product-input";
import { updateBiocharProductInTransaction } from "@/data-access/biochar-product-update";
import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { toBiocharProductRecord } from "@/data-access/biochar-product-record";
import { biocharProducts, type BiocharProductRecord } from "@/db/schema";
import { deriveBlendMassKg } from "@/lib/biochar-composition/composition";
import { DomainError } from "@/lib/domain-errors";
import { withOutputStockErrors } from "@/lib/output-stock-domain-errors";
import { makeBiocharProductInput, updateBiocharProductInput, type MakeBiocharProductInput } from "@/schemas/biochar-product-input";
import { hasLocalEventInstant, resolveEventInstant } from "./event-times";
import { GENERATED_MOVEMENT_KEY_PREFIX } from "./output-stock";
import type { OperationEffect } from "@/lib/operation-effect";
import type { Operation, OperationScope } from "./runner";

const AUTO_CODE_COUNT = 1;
const PRODUCT_ENTITY = "biocharProduct";
const NOT_A_LINE_MESSAGE = "This ingredient is not part of the chosen formulation.";
const MISSING_LINES_MESSAGE = "Enter a mass for every ingredient of the formulation, 0 kg for one not used.";

/** Preconditions, request keys and the target describe how a write was sent, not what it changed. */
const NOT_CHANGES: ReadonlySet<string> = new Set(["basisFingerprint", "idempotencyKey", "expectedVersion", "biocharProductId"]);

function changedFields(input: object): string[] {
  return Object.entries(input).filter(([key, value]) => value !== undefined && !NOT_CHANGES.has(key)).map(([key]) => key).sort();
}

/**
 * The composition a product records: each formulation line as mixed, with the
 * material and ratio the formulation names now, in recipe order whatever
 * order the caller listed them in, so the same product always reads the same.
 * Every line is required once; the data access checks the feedstock bins.
 */
function compositionFromLines(ingredients: MakeBiocharProductInput["ingredients"], lines: readonly ProductFormulationLine[]): Record<string, unknown> {
  const rows = ingredients.map((ingredient, index) => {
    const line = lines.find((candidate) => candidate.id === ingredient.formulationIngredientId);
    if (!line) {
      throw new DomainError("validation_failed", NOT_A_LINE_MESSAGE, {
        issues: [{ path: ["ingredients", index, "formulationIngredientId"], code: "validation_failed", message: NOT_A_LINE_MESSAGE }],
      });
    }
    const { formulationIngredientId, ...facts } = ingredientFacts(ingredient);
    return {
      formulationIngredientId, feedstockTypeId: line.feedstockTypeId, feedstockTypeName: line.feedstockTypeName,
      feedstockTypeCategory: line.feedstockTypeCategory, ratio: line.ratio, ...facts,
    };
  });
  if (lines.some((line) => !ingredients.some((ingredient) => ingredient.formulationIngredientId === line.id))) {
    throw new DomainError("validation_failed", MISSING_LINES_MESSAGE, {
      issues: [{ path: ["ingredients"], code: "validation_failed", message: MISSING_LINES_MESSAGE }],
    });
  }
  const recipeOrder = (row: { formulationIngredientId: string }) => lines.findIndex((line) => line.id === row.formulationIngredientId);
  return rows.length ? { ingredients: rows.sort((a, b) => recipeOrder(a) - recipeOrder(b)) } : {};
}

/** What the operator entered for one formulation line, under the names `compositionFromLines` records it with. */
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
    const { ctx, tx, snapshotStock } = scope;
    const committed = await findCommittedProduct(scope, input);
    if (committed) return committed;
    // The facility supplies the zone a facility-local placement is read in.
    const facility = await readProductFacility(ctx, tx, input.facilityId);
    const composition = compositionFromLines(input.ingredients, await readProductFormulationLines(ctx, tx, input.formulationId));
    const placedAt = resolveEventInstant(input.placedAt, facility.timeZone, ["placedAt"]).toISOString();
    // A fresh movement key per execution never double-posts; see GENERATED_MOVEMENT_KEY_PREFIX.
    const idempotencyKey = input.idempotencyKey ?? `${GENERATED_MOVEMENT_KEY_PREFIX}${randomUUID()}`;
    const request = productRequest(input, placedAt, idempotencyKey);
    // Each code attempt runs the whole create, posting seam included, in its own savepoint.
    const created = await withAutoCodes(ctx, tx, "BP", biocharProducts, biocharProducts.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createBiocharProductInTransaction(ctx, savepoint, { code, ...request, composition }, { snapshotStock }),
      CODE_CONFLICT_MESSAGES.biocharProduct);
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
  execute: ({ ctx, tx }, { biocharProductId, ...changes }) => withOutputStockErrors(async () => toBiocharProductRecord(await updateBiocharProductInTransaction(ctx, tx, biocharProductId, changes))),
};
