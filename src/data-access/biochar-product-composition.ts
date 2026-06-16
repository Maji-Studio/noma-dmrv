/**
 * Composition-bin validation for biochar products.
 *
 * A product's composition maps each formulation ingredient to the feedstock bin
 * the blend material is drawn from. This validates that those references point
 * at real formulation lines and that each bin is a feedstock bin holding the
 * matching blend-usage feedstock type. Extracted from the biochar-products DAL
 * to keep that file under the 1000-line cap.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  formulationIngredients,
  storageLocations,
  feedstockTypes,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";

interface CompositionIngredientRef {
  formulationIngredientId: string;
  feedstockTypeId: string;
  storageLocationId: string | null;
}

function getCompositionIngredientRefs(
  composition: Record<string, unknown> | null | undefined,
): CompositionIngredientRef[] {
  const ingredients = composition?.ingredients;
  if (!Array.isArray(ingredients)) return [];

  return ingredients
    .map((ingredient) => {
      if (
        typeof ingredient !== "object" ||
        ingredient === null ||
        !("formulationIngredientId" in ingredient) ||
        !("feedstockTypeId" in ingredient) ||
        typeof ingredient.formulationIngredientId !== "string" ||
        typeof ingredient.feedstockTypeId !== "string"
      ) {
        return null;
      }
      return {
        formulationIngredientId: ingredient.formulationIngredientId,
        feedstockTypeId: ingredient.feedstockTypeId,
        storageLocationId:
          "storageLocationId" in ingredient &&
          typeof ingredient.storageLocationId === "string"
            ? ingredient.storageLocationId
            : null,
      };
    })
    .filter((ref): ref is CompositionIngredientRef =>
      Boolean(ref?.formulationIngredientId && ref.feedstockTypeId),
    );
}

export async function validateCompositionIngredientBins(
  tx: Pick<typeof db, "select">,
  composition: Record<string, unknown> | null | undefined,
  formulationId: string | null,
  facilityId: string,
) {
  const ingredientRefs = getCompositionIngredientRefs(composition);
  if (ingredientRefs.length > 0) {
    if (!formulationId) {
      throw new SafeError("Formulation is required for ingredient composition");
    }

    const ingredientIds = [
      ...new Set(ingredientRefs.map((ref) => ref.formulationIngredientId)),
    ];
    const ingredientRows = await tx
      .select({
        id: formulationIngredients.id,
        formulationId: formulationIngredients.formulationId,
        feedstockTypeId: formulationIngredients.feedstockTypeId,
      })
      .from(formulationIngredients)
      .where(inArray(formulationIngredients.id, ingredientIds));
    const ingredientById = new Map(
      ingredientRows.map((row) => [row.id, row]),
    );
    const missingIngredientIds = ingredientIds.filter(
      (id) => !ingredientById.has(id),
    );
    if (missingIngredientIds.length > 0) {
      throw new SafeError(
        `Composition ingredient line(s) not found: ${missingIngredientIds.join(", ")}`,
      );
    }
    const wrongFormulationIds = ingredientRefs
      .filter(
        (ref) =>
          ingredientById.get(ref.formulationIngredientId)?.formulationId !==
          formulationId,
      )
      .map((ref) => ref.formulationIngredientId);
    if (wrongFormulationIds.length > 0) {
      throw new SafeError(
        `Composition ingredient line(s) must belong to the selected formulation: ${wrongFormulationIds.join(", ")}`,
      );
    }
    const mismatchedIngredientIds = ingredientRefs
      .filter(
        (ref) =>
          ingredientById.get(ref.formulationIngredientId)?.feedstockTypeId !==
          ref.feedstockTypeId,
      )
      .map((ref) => ref.formulationIngredientId);
    if (mismatchedIngredientIds.length > 0) {
      throw new SafeError(
        `Composition ingredient line(s) must match the selected formulation material: ${mismatchedIngredientIds.join(", ")}`,
      );
    }
  }

  const binRefs = ingredientRefs.filter(
    (ref): ref is CompositionIngredientRef & { storageLocationId: string } =>
      Boolean(ref.storageLocationId),
  );
  const storageLocationIds = [
    ...new Set(binRefs.map((ref) => ref.storageLocationId)),
  ];
  if (storageLocationIds.length === 0) return;
  const expectedFeedstockTypeByBinId = new Map<string, string>();
  for (const ref of binRefs) {
    const existing = expectedFeedstockTypeByBinId.get(ref.storageLocationId);
    if (existing && existing !== ref.feedstockTypeId) {
      throw new SafeError(
        "Feedstock bin cannot be reused for different formulation materials",
      );
    }
    expectedFeedstockTypeByBinId.set(ref.storageLocationId, ref.feedstockTypeId);
  }

  const bins = await tx
    .select({
      id: storageLocations.id,
      facilityId: storageLocations.facilityId,
      type: storageLocations.type,
      feedstockTypeId: storageLocations.feedstockTypeId,
      feedstockTypeUsage: feedstockTypes.usage,
    })
    .from(storageLocations)
    .leftJoin(feedstockTypes, eq(storageLocations.feedstockTypeId, feedstockTypes.id))
    .where(inArray(storageLocations.id, storageLocationIds));

  if (bins.length !== storageLocationIds.length) {
    throw new SafeError("Feedstock bin not found");
  }

  for (const bin of bins) {
    if (bin.facilityId !== facilityId) {
      throw new SafeError("Feedstock bin belongs to a different facility");
    }
    if (bin.type !== "feedstock_bin") {
      throw new SafeError("Selected bin must be a feedstock bin");
    }
    if (!bin.feedstockTypeId || bin.feedstockTypeUsage !== "blend") {
      throw new SafeError("Feedstock bin must hold blend-usage feedstock");
    }
    if (bin.feedstockTypeId !== expectedFeedstockTypeByBinId.get(bin.id)) {
      throw new SafeError("Feedstock bin must match the formulation material");
    }
  }
}
