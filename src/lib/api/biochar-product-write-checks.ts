import type { ApiContext } from "@/lib/auth/api-context";
import { findMissingProductReference, type ProductReference, type ProductReferenceKind } from "@/data-access/biochar-product-references";
import { outputReferenceNotFound } from "@/data-access/output-stock-errors";
import { BIOCHAR_PRODUCT_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import { describeMadeProduct, describeUpdatedProduct, makeBiocharProduct, updateBiocharProduct } from "@/lib/operations/biochar-products";
import type { Operation, OperationResult, OperationScope } from "@/lib/operations/runner";
import { readApiBiocharProduct } from "@/lib/read-models/api-biochar-products";
import { biocharProductRepresentationSchema, type BiocharProductRepresentation } from "@/lib/representations/biochar-products";
import { makeBiocharProductApiInput, updateBiocharProductInput, type MakeBiocharProductInput } from "@/schemas/biochar-product-input";
import { ApiHttpError } from "./http-error";

const NOT_FOUND_MESSAGES: Record<ProductReferenceKind, string> = {
  facility: "Facility was not found.",
  formulation: "Formulation was not found.",
  storageLocation: "Storage location was not found.",
  formulationIngredient: "Formulation ingredient was not found.",
};

/** Every reference the body names, in body order, each with the pointer a refusal reports. */
export function productReferences(input: Pick<MakeBiocharProductInput, "facilityId" | "formulationId" | "sourceBiocharStorageLocationId" | "storageLocationId" | "ingredients">): ProductReference[] {
  return [
    { kind: "facility", id: input.facilityId, path: ["facilityId"] },
    { kind: "formulation", id: input.formulationId, path: ["formulationId"] },
    { kind: "storageLocation", id: input.sourceBiocharStorageLocationId, path: ["sourceBiocharStorageLocationId"] },
    { kind: "storageLocation", id: input.storageLocationId, path: ["storageLocationId"] },
    ...input.ingredients.flatMap((ingredient, index): ProductReference[] => [
      { kind: "formulationIngredient", id: ingredient.formulationIngredientId, path: ["ingredients", index, "formulationIngredientId"] },
      ...(ingredient.storageLocationId ? [{ kind: "storageLocation" as const, id: ingredient.storageLocationId, path: ["ingredients", index, "storageLocationId"] }] : []),
    ]),
  ];
}

/**
 * An unknown or foreign reference answers 404 on its own pointer, before the
 * product's own guards can call it a 422. Runs inside the operation, so a
 * replay is answered from the stored outcome first, as for every adapter check.
 */
export async function assertProductReferencesExist({ ctx, tx }: OperationScope, input: Parameters<typeof productReferences>[0]) {
  const missing = await findMissingProductReference(ctx, tx, productReferences(input));
  if (missing) throw outputReferenceNotFound(NOT_FOUND_MESSAGES[missing.kind], missing.path);
}

/** A created product as published, with the stock basis it was drawn on. */
export interface MadeProductOutput {
  product: BiocharProductRepresentation;
  basisFingerprint: string;
}

/**
 * Check references, run the create, and read the public projection inside the
 * write transaction, so saved, dry-run and replayed outcomes share one shape.
 * The input is the published body only: no request key, no UI fields.
 */
export const representationCheckedMake: Operation<typeof makeBiocharProductApiInput, MadeProductOutput> = {
  id: makeBiocharProduct.id,
  input: makeBiocharProductApiInput,
  supportsDryRun: true,
  describe: (input, output) => describeMadeProduct(input, output.product),
  execute: async (scope, input) => {
    await assertProductReferencesExist(scope, input);
    const created = await makeBiocharProduct.execute(scope, input);
    return {
      product: await readApiBiocharProduct(scope.ctx, { id: created.product.id }, scope.tx),
      basisFingerprint: created.basisFingerprint,
    };
  },
};

async function checkRepresentation(scope: OperationScope, id: string, revision: number) {
  const row = await readApiBiocharProduct(scope.ctx, { id }, scope.tx);
  if (revision !== BIOCHAR_PRODUCT_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
  return row;
}

export function representationCheckedUpdate(id: string, revision: number): Operation<typeof updateBiocharProductInput, BiocharProductRepresentation> {
  return {
    ...updateBiocharProduct,
    describe: (input, output) => describeUpdatedProduct(input, output, input.expectedVersion),
    execute: async (scope, input) => {
      await checkRepresentation(scope, id, revision);
      await updateBiocharProduct.execute(scope, input);
      return readApiBiocharProduct(scope.ctx, { id }, scope.tx);
    },
  };
}

export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) {
    if (error instanceof DomainError && error.code === "stale_version") {
      const current = await readApiBiocharProduct(ctx, { id });
      throw new ApiHttpError(412, "stale_version", "The biochar product has changed. Read the current representation before retrying.", current);
    }
    throw error;
  }
}

/** Replays come back from JSON storage with keys reordered; the schema restores the published order. */
export function productBodyData(product: BiocharProductRepresentation): BiocharProductRepresentation {
  return biocharProductRepresentationSchema.parse(product);
}

export function madeProductBody(result: OperationResult<MadeProductOutput>, dryRun: boolean) {
  return {
    data: productBodyData(result.data.product),
    ...(dryRun ? { stockEffects: result.stockEffects, basisFingerprint: result.data.basisFingerprint } : {}),
  };
}
