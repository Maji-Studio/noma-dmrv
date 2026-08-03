/**
 * Composition-bin validation for biochar products.
 *
 * A product's composition maps each formulation ingredient to the feedstock bin
 * the blend material is drawn from. This validates that those references point
 * at real formulation lines and that each bin is a feedstock bin holding the
 * matching blend-usage feedstock type. Extracted from the biochar-products DAL
 * to keep that file under the 1000-line cap.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { countRows, sumNumeric } from "@/db/aggregate";
import type { OrgContext } from "@/lib/auth/server";
import {
  feedstocks,
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
  /** Wet/as-received mass recorded by the operator. */
  massKg: number;
  /** Server-derived dry-mass allocation snapshot. */
  massDryKg: number | null;
  moistureContentPercent: number | null;
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
        massDryKg:
          "massDryKg" in ingredient &&
          typeof ingredient.massDryKg === "number" &&
          Number.isFinite(ingredient.massDryKg)
            ? ingredient.massDryKg
            : null,
        moistureContentPercent:
          "moistureContentPercent" in ingredient &&
          typeof ingredient.moistureContentPercent === "number" &&
          Number.isFinite(ingredient.moistureContentPercent)
            ? ingredient.moistureContentPercent
            : null,
      };
    })
    .filter((ref): ref is CompositionIngredientRef =>
      Boolean(ref?.formulationIngredientId && ref.feedstockTypeId),
    );
}

const MASS_PRECISION_FACTOR = 1_000;
const PERCENT_PRECISION_FACTOR = 10_000_000;

function massSnapshotKey(ingredient: Record<string, unknown>): string {
  const massGrams =
    typeof ingredient.massKg === "number" &&
    Number.isFinite(ingredient.massKg)
      ? Math.round(ingredient.massKg * MASS_PRECISION_FACTOR)
      : null;
  return JSON.stringify([
    ingredient.formulationIngredientId ?? null,
    ingredient.feedstockTypeId ?? null,
    ingredient.storageLocationId ?? null,
    massGrams,
  ]);
}

function persistedIngredientMassSnapshot(
  ingredient: Record<string, unknown> | undefined,
): { massDryKg: number; moistureContentPercent: number } | null {
  if (
    !ingredient ||
    typeof ingredient.massDryKg !== "number" ||
    !Number.isFinite(ingredient.massDryKg) ||
    ingredient.massDryKg < 0 ||
    typeof ingredient.moistureContentPercent !== "number" ||
    !Number.isFinite(ingredient.moistureContentPercent) ||
    ingredient.moistureContentPercent < 0 ||
    ingredient.moistureContentPercent > 100
  ) {
    return null;
  }
  return {
    massDryKg: ingredient.massDryKg,
    moistureContentPercent: ingredient.moistureContentPercent,
  };
}

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
          ? Math.round(ingredient.massKg * MASS_PRECISION_FACTOR)
          : null,
      massDryGrams:
        typeof ingredient.massDryKg === "number" &&
        Number.isFinite(ingredient.massDryKg)
          ? Math.round(ingredient.massDryKg * MASS_PRECISION_FACTOR)
          : null,
      moistureBasis:
        typeof ingredient.moistureContentPercent === "number" &&
        Number.isFinite(ingredient.moistureContentPercent)
          ? Math.round(
              ingredient.moistureContentPercent *
                PERCENT_PRECISION_FACTOR,
            )
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
  /** Wet/as-received mass used to derive source biochar in the blend. */
  massKg: number;
  /** Dry mass deducted from the feedstock bin. */
  massDryKg: number | null;
}

export function getCompositionIngredientDraws(
  composition: Record<string, unknown> | null | undefined,
): CompositionIngredientDraw[] {
  const byStorageLocation = new Map<
    string,
    { massKg: number; massDryKg: number | null }
  >();
  for (const ref of getCompositionIngredientRefs(composition)) {
    if (ref.massKg <= 0) continue;
    if (!ref.storageLocationId) {
      throw new SafeError(
        "Choose a feedstock bin for every ingredient with a positive mass",
      );
    }
    const existing = byStorageLocation.get(ref.storageLocationId);
    byStorageLocation.set(ref.storageLocationId, {
      massKg: (existing?.massKg ?? 0) + ref.massKg,
      massDryKg:
        existing?.massDryKg === null || ref.massDryKg === null
          ? null
          : (existing?.massDryKg ?? 0) + ref.massDryKg,
    });
  }
  return [...byStorageLocation.entries()].map(
    ([storageLocationId, mass]) => ({ storageLocationId, ...mass }),
  );
}

const INGREDIENT_MOISTURE_BASIS_ERROR =
  "This ingredient bin has no complete wet-mass and moisture basis. Complete its feedstock intake before using it in a blend.";

function roundMassKg(value: number): number {
  return Math.round(value * MASS_PRECISION_FACTOR) / MASS_PRECISION_FACTOR;
}

function roundPercent(value: number): number {
  return Math.round(value * PERCENT_PRECISION_FACTOR) /
    PERCENT_PRECISION_FACTOR;
}

interface FeedstockMassBasis {
  totalWetKg: number;
  totalDryKg: number;
  missingWetMassCount: number;
}

function deriveIngredientMassSnapshot(
  wetMassKg: number,
  basis: FeedstockMassBasis | undefined,
): { massDryKg: number; moistureContentPercent: number } {
  if (
    !basis ||
    basis.missingWetMassCount > 0 ||
    basis.totalWetKg <= 0 ||
    basis.totalDryKg <= 0 ||
    basis.totalDryKg > basis.totalWetKg
  ) {
    throw new SafeError(INGREDIENT_MOISTURE_BASIS_ERROR);
  }

  const dryRatio = basis.totalDryKg / basis.totalWetKg;
  return {
    massDryKg: roundMassKg(wetMassKg * dryRatio),
    moistureContentPercent: roundPercent((1 - dryRatio) * 100),
  };
}

/**
 * Freeze each ingredient's dry-mass withdrawal from the selected bin's
 * completed intake basis. `massKg` stays the operator's wet/as-received mass;
 * the derived fields are server-owned allocation facts persisted in JSONB.
 * Call only while the caller holds every ingredient bin's stock lock.
 */
export async function resolveCompositionIngredientMassBasis(
  ctx: OrgContext,
  tx: DbTransaction,
  composition: Record<string, unknown> | null | undefined,
  previousComposition?: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  requireOrgScope(ctx);
  const ingredients = getCompositionIngredientObjects(composition);
  if (ingredients.length === 0) return composition ?? {};
  const previousIngredientsByKey = new Map(
    getCompositionIngredientObjects(previousComposition).map((ingredient) => [
      massSnapshotKey(ingredient),
      ingredient,
    ]),
  );
  const positiveRefs = getCompositionIngredientRefs(composition).filter(
    (ref) => ref.massKg > 0,
  );
  const storageLocationIds = [
    ...new Set(
      positiveRefs.map((ref) => {
        if (!ref.storageLocationId) {
          throw new SafeError(
            "Choose a feedstock bin for every ingredient with a positive mass",
          );
        }
        return ref.storageLocationId;
      }),
    ),
  ];

  const basisRows = storageLocationIds.length > 0
    ? await tx
        .select({
          storageLocationId: feedstocks.storageLocationId,
          totalWetKg: sumNumeric(feedstocks.massWetKg),
          totalDryKg: sumNumeric(feedstocks.massDryKg),
          missingWetMassCount: countRows(
            sql`${feedstocks.massWetKg} IS NULL AND ${feedstocks.massDryKg} > 0`,
          ),
        })
        .from(feedstocks)
        .where(
          and(
            inArray(feedstocks.storageLocationId, storageLocationIds),
            eq(feedstocks.organizationId, ctx.organizationId),
            eq(feedstocks.status, "complete"),
          ),
        )
        .groupBy(feedstocks.storageLocationId)
    : [];
  const basisByStorageLocation = new Map(
    basisRows
      .filter(
        (row): row is typeof row & { storageLocationId: string } =>
          row.storageLocationId !== null,
      )
      .map((row) => [row.storageLocationId, row]),
  );

  return {
    ...(composition ?? {}),
    ingredients: ingredients.map((ingredient) => {
      const wetMassKg =
        typeof ingredient.massKg === "number" &&
        Number.isFinite(ingredient.massKg)
          ? ingredient.massKg
          : 0;
      if (wetMassKg < 0) {
        throw new SafeError("Ingredient wet mass must be 0 or greater");
      }
      if (wetMassKg === 0) {
        return {
          ...ingredient,
          massDryKg: 0,
          moistureContentPercent: null,
        };
      }
      const previousSnapshot = persistedIngredientMassSnapshot(
        previousIngredientsByKey.get(massSnapshotKey(ingredient)),
      );
      if (previousSnapshot) {
        return { ...ingredient, ...previousSnapshot };
      }
      const storageLocationId =
        typeof ingredient.storageLocationId === "string"
          ? ingredient.storageLocationId
          : null;
      if (!storageLocationId) {
        throw new SafeError(
          "Choose a feedstock bin for every ingredient with a positive mass",
        );
      }
      return {
        ...ingredient,
        ...deriveIngredientMassSnapshot(
          wetMassKg,
          basisByStorageLocation.get(storageLocationId),
        ),
      };
    }),
  };
}

export async function assertCompositionIngredientDrawsWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  composition: Record<string, unknown> | null | undefined,
  excludeProductId?: string,
): Promise<void> {
  requireOrgScope(ctx);
  for (const draw of getCompositionIngredientDraws(composition)) {
    if (draw.massDryKg === null) {
      throw new SafeError(INGREDIENT_MOISTURE_BASIS_ERROR);
    }
    await assertFeedstockDrawWithinStock(ctx, tx, {
      storageLocationId: draw.storageLocationId,
      requestedDryKg: draw.massDryKg,
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
