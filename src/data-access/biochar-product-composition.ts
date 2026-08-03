/**
 * Composition-bin validation for biochar products.
 *
 * A product's composition maps each formulation ingredient to the feedstock bin
 * the blend material is drawn from. This validates that those references point
 * at real formulation lines and that each bin is a feedstock bin holding the
 * matching blend-usage feedstock type. Extracted from the biochar-products DAL
 * to keep that file under the 1000-line cap.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  formulationIngredients,
  storageLocations,
  feedstockTypes,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";
import { formatCount } from "@/lib/copy-utils";
import { deriveSourceBiocharMassKg } from "@/lib/biochar-composition";
import type { DbTransaction } from "@/db";
import { assertFeedstockDrawWithinStock } from "./bin-stock-guards";
import { requireOrgScope } from "./utils";

interface CompositionIngredientRef {
  formulationIngredientId: string;
  feedstockTypeId: string;
  storageLocationId: string | null;
  massKg: number;
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
        massKg:
          "massKg" in ingredient &&
          typeof ingredient.massKg === "number" &&
          Number.isFinite(ingredient.massKg)
            ? ingredient.massKg
            : 0,
      };
    })
    .filter((ref): ref is CompositionIngredientRef =>
      Boolean(ref?.formulationIngredientId && ref.feedstockTypeId),
    );
}

const GRAMS_PER_KILOGRAM = 1_000;

function getCompositionIngredientObjects(
  composition: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  return Array.isArray(composition?.ingredients)
    ? composition.ingredients.filter(
        (ingredient): ingredient is Record<string, unknown> =>
          typeof ingredient === "object" && ingredient !== null,
      )
    : [];
}

function canonicalAllocationIngredients(
  composition: Record<string, unknown> | null | undefined,
) {
  return getCompositionIngredientObjects(composition)
    .map((ingredient) => ({
      formulationIngredientId:
        typeof ingredient.formulationIngredientId === "string"
          ? ingredient.formulationIngredientId
          : null,
      feedstockTypeId:
        typeof ingredient.feedstockTypeId === "string"
          ? ingredient.feedstockTypeId
          : null,
      storageLocationId:
        typeof ingredient.storageLocationId === "string"
          ? ingredient.storageLocationId
          : null,
      massGrams:
        typeof ingredient.massKg === "number" &&
        Number.isFinite(ingredient.massKg)
          ? Math.round(ingredient.massKg * GRAMS_PER_KILOGRAM)
          : null,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

/** Compare only persisted composition facts that affect physical allocations. */
export function compositionAllocationChanged(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): boolean {
  return JSON.stringify(canonicalAllocationIngredients(previous)) !==
    JSON.stringify(canonicalAllocationIngredients(next));
}

/** Derive source mass without requiring legacy ingredient rows to name a bin. */
export function deriveCompositionSourceBiocharMassKg(
  blendMassKg: number | null | undefined,
  composition: Record<string, unknown> | null | undefined,
): number | null {
  return deriveSourceBiocharMassKg(
    blendMassKg,
    getCompositionIngredientObjects(composition),
  );
}

export interface CompositionIngredientDraw {
  storageLocationId: string;
  massKg: number;
}

export function getCompositionIngredientDraws(
  composition: Record<string, unknown> | null | undefined,
): CompositionIngredientDraw[] {
  const byStorageLocation = new Map<string, number>();
  for (const ref of getCompositionIngredientRefs(composition)) {
    if (ref.massKg <= 0) continue;
    if (!ref.storageLocationId) {
      throw new SafeError(
        "Choose a feedstock bin for every ingredient with a positive mass",
      );
    }
    byStorageLocation.set(
      ref.storageLocationId,
      (byStorageLocation.get(ref.storageLocationId) ?? 0) + ref.massKg,
    );
  }
  return [...byStorageLocation.entries()].map(
    ([storageLocationId, massKg]) => ({ storageLocationId, massKg }),
  );
}

export async function assertCompositionIngredientDrawsWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  composition: Record<string, unknown> | null | undefined,
  excludeProductId?: string,
): Promise<void> {
  requireOrgScope(ctx);
  for (const draw of getCompositionIngredientDraws(composition)) {
    await assertFeedstockDrawWithinStock(ctx, tx, {
      storageLocationId: draw.storageLocationId,
      requestedDryKg: draw.massKg,
      excludeProductId,
      binLockAlreadyHeld: true,
    });
  }
}

export async function validateCompositionIngredientBins(
  ctx: OrgContext,
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
      .where(and(
        inArray(formulationIngredients.id, ingredientIds),
        eq(formulationIngredients.organizationId, ctx.organizationId),
      ));
    const ingredientById = new Map(
      ingredientRows.map((row) => [row.id, row]),
    );
    const missingIngredientIds = ingredientIds.filter(
      (id) => !ingredientById.has(id),
    );
    if (missingIngredientIds.length > 0) {
      throw new SafeError(
        `${formatCount(missingIngredientIds.length, "Formulation line")} ${missingIngredientIds.length === 1 ? "was" : "were"} not found. Refresh the product and choose its feedstock bins again.`,
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
        `${formatCount(wrongFormulationIds.length, "Formulation line")} ${wrongFormulationIds.length === 1 ? "does" : "do"} not belong to the selected formulation. Refresh the product and choose its feedstock bins again.`,
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
        `${formatCount(mismatchedIngredientIds.length, "Formulation line")} ${mismatchedIngredientIds.length === 1 ? "does" : "do"} not match the selected feedstock type. Refresh the product and choose its feedstock bins again.`,
      );
    }
  }

  // A formulated product must record every recipe line — ingredient masses
  // are required entries, so a composition that omits formulation lines is
  // rejected here even if the client submitted before the formulation's
  // ingredient list had loaded.
  if (formulationId) {
    const formulationLines = await tx
      .select({ id: formulationIngredients.id })
      .from(formulationIngredients)
      .where(and(
        eq(formulationIngredients.formulationId, formulationId),
        eq(formulationIngredients.organizationId, ctx.organizationId),
      ));
    const providedIds = new Set(
      ingredientRefs.map((ref) => ref.formulationIngredientId),
    );
    if (formulationLines.some((line) => !providedIds.has(line.id))) {
      throw new SafeError(
        "Composition must include every ingredient of the selected formulation. Re-select the formulation and enter each ingredient's mass.",
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
    .leftJoin(feedstockTypes, and(
      eq(storageLocations.feedstockTypeId, feedstockTypes.id),
      eq(feedstockTypes.organizationId, ctx.organizationId),
    ))
    .where(and(
      inArray(storageLocations.id, storageLocationIds),
      eq(storageLocations.organizationId, ctx.organizationId),
      isNull(storageLocations.archivedAt),
    ));

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
