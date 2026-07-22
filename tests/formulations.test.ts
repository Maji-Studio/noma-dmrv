import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  facilities,
  feedstockTypes,
  formulations,
} from "@/db/schema";
import {
  createFormulation,
  updateFormulation,
} from "@/data-access/formulations";
import {
  fromCompositionJsonb,
  reconcileComposition,
} from "@/lib/biochar-composition";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

describe("updateFormulation ingredient identity", () => {
  const createdProductIds: string[] = [];
  const createdFormulationIds: string[] = [];
  const createdFeedstockTypeIds: string[] = [];
  const createdFacilityIds: string[] = [];

  beforeAll(() => ensureTestOrg());

  afterAll(async () => {
    if (createdProductIds.length > 0) {
      await db
        .delete(biocharProducts)
        .where(inArray(biocharProducts.id, createdProductIds));
    }
    if (createdFormulationIds.length > 0) {
      await db.delete(formulations).where(inArray(formulations.id, createdFormulationIds));
    }
    if (createdFeedstockTypeIds.length > 0) {
      await db
        .delete(feedstockTypes)
        .where(inArray(feedstockTypes.id, createdFeedstockTypeIds));
    }
    if (createdFacilityIds.length > 0) {
      await db.delete(facilities).where(inArray(facilities.id, createdFacilityIds));
    }
  });

  it("preserves ingredient ids and saved composition masses on ratio-only edits", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-FORM-${tag}`,
        name: `Formulation Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    createdFacilityIds.push(facility.id);

    const ingredientTypes = await db
      .insert(feedstockTypes)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `FT-FORM-A-${tag}`,
          name: `Blend A ${tag}`,
          category: "ingredient",
          usage: "blend",
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FT-FORM-B-${tag}`,
          name: `Blend B ${tag}`,
          category: "ingredient",
          usage: "blend",
        },
      ])
      .returning({ id: feedstockTypes.id });
    createdFeedstockTypeIds.push(...ingredientTypes.map(({ id }) => id));

    const formulation = await createFormulation(makeTestOrgContext(), {
      code: `FM-STABLE-${tag}`,
      name: `Stable formulation ${tag}`,
      biocharRatio: 0.6,
      ingredients: [
        { feedstockTypeId: ingredientTypes[0].id, ratio: 0.25 },
        { feedstockTypeId: ingredientTypes[1].id, ratio: 0.15 },
      ],
    });
    createdFormulationIds.push(formulation.id);

    const savedMassByIngredientId = new Map(
      formulation.ingredients.map((ingredient, index) => [
        ingredient.id,
        index === 0 ? 25 : 15,
      ]),
    );
    const savedComposition = {
      ingredients: formulation.ingredients.map((ingredient) => ({
        formulationIngredientId: ingredient.id,
        feedstockTypeId: ingredient.feedstockTypeId,
        feedstockTypeName: ingredient.feedstockType.name,
        feedstockTypeCategory: ingredient.feedstockType.category,
        ratio: ingredient.ratio,
        massKg: savedMassByIngredientId.get(ingredient.id),
        storageLocationId: null,
      })),
    };
    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BP-FORM-${tag}`,
        facilityId: facility.id,
        formulationId: formulation.id,
        massKg: 100,
        composition: savedComposition,
      })
      .returning({ id: biocharProducts.id });
    createdProductIds.push(product.id);

    const updated = await updateFormulation(makeTestOrgContext(), formulation.id, {
      ingredients: [
        { feedstockTypeId: ingredientTypes[0].id, ratio: 0.2 },
        { feedstockTypeId: ingredientTypes[1].id, ratio: 0.2 },
      ],
    });

    expect(updated.ingredients.map(({ id }) => id)).toEqual(
      formulation.ingredients.map(({ id }) => id),
    );

    const [storedProduct] = await db
      .select({ composition: biocharProducts.composition })
      .from(biocharProducts)
      .where(eq(biocharProducts.id, product.id));
    const reconciled = reconcileComposition(
      updated,
      fromCompositionJsonb(storedProduct.composition),
    );
    expect(reconciled.map(({ massKg }) => massKg)).toEqual([25, 15]);
  });
});
