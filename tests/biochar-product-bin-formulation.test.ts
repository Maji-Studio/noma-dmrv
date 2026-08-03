import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * Server-side enforcement of the "one formulation per product bin" rule.
 *
 * Covers the three branches added to `createBiocharProduct`:
 *   - an unassigned bin is CLAIMED for the product's formulation on first use,
 *   - a bin reserved for a different formulation is REJECTED,
 *   - a pure-biochar product (null formulation) is allowed in an unassigned bin
 *     and leaves it unclaimed (still pure).
 *
 * Real-DB integration test (mirrors tests/applications-delete.test.ts): inserts
 * a minimal fixture, exercises the data-access function, asserts, cleans up.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  createBiocharProduct,
  updateBiocharProduct,
} from "@/data-access/biochar-products";
import { updateFormulation } from "@/data-access/formulations";
import { getEntityById } from "@/data-access/entities";
import { getStockAvailability } from "@/data-access/stock-availability";
import { facilities, reactors, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import { productionRuns } from "@/db/schema/production";
import {
  biocharProducts,
  biocharProductSourceAllocations,
  formulationIngredients,
  formulations,
} from "@/db/schema/products";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";


describe("createBiocharProduct — product bin ↔ formulation", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  let facilityId: string;
  let reactorId: string;
  let runId: string;
  let formulationAId: string;
  let formulationBId: string;
  let formulationIngredientAId: string;
  let pyrolysisTypeId: string;
  let blendTypeAId: string;
  let blendTypeBId: string;
  const createdBinIds: string[] = [];
  const createdFeedstockIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdSourceRunIds: string[] = [];

  beforeAll(() => ensureTestOrg());

beforeAll(async () => {
    const [facility] = await db
      .insert(facilities)
      .values({ organizationId: TEST_ORG_ID, code: `FAC-PBF-${tag}`, name: `PBF Facility ${tag}` })
      .returning({ id: facilities.id });
    facilityId = facility.id;

    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        code: `R-PBF-${tag}`,
        identifier: `PBF Reactor ${tag}`,
        facilityId,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    reactorId = reactor.id;

    const [run] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        code: `PR-PBF-${tag}`,
        facilityId,
        reactorId,
        status: "complete",
        startTime: new Date("2026-01-01T08:00:00Z"),
        endTime: new Date("2026-01-01T12:00:00Z"),
      })
      .returning({ id: productionRuns.id });
    runId = run.id;

    const [formulationA] = await db
      .insert(formulations)
      .values({ organizationId: TEST_ORG_ID, code: `FM-PBF-A-${tag}`, name: `PBF Blend A ${tag}`, biocharRatio: 0.6 })
      .returning({ id: formulations.id });
    formulationAId = formulationA.id;

    const [formulationB] = await db
      .insert(formulations)
      .values({ organizationId: TEST_ORG_ID, code: `FM-PBF-B-${tag}`, name: `PBF Blend B ${tag}`, biocharRatio: 0.4 })
      .returning({ id: formulations.id });
    formulationBId = formulationB.id;

    const [pyrolysisType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-PBF-P-${tag}`,
        name: `PBF Pyrolysis Type ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    pyrolysisTypeId = pyrolysisType.id;

    const [blendTypeA] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-PBF-BA-${tag}`,
        name: `PBF Blend Type A ${tag}`,
        category: "compost",
        usage: "blend",
      })
      .returning({ id: feedstockTypes.id });
    blendTypeAId = blendTypeA.id;

    const [blendTypeB] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-PBF-BB-${tag}`,
        name: `PBF Blend Type B ${tag}`,
        category: "mineral",
        usage: "blend",
      })
      .returning({ id: feedstockTypes.id });
    blendTypeBId = blendTypeB.id;

    const [formulationIngredientA] = await db
      .insert(formulationIngredients)
      .values({
        organizationId: TEST_ORG_ID,
        formulationId: formulationAId,
        feedstockTypeId: blendTypeAId,
        ratio: 0.2,
      })
      .returning({ id: formulationIngredients.id });
    formulationIngredientAId = formulationIngredientA.id;
  });

  afterAll(async () => {
    async function cleanup(step: () => Promise<unknown>) {
      try {
        await step();
      } catch {
        // Best-effort teardown; keep the original test failure visible.
      }
    }

    if (createdProductIds.length > 0) {
      await cleanup(() =>
        db.delete(biocharProducts).where(inArray(biocharProducts.id, createdProductIds)),
      );
    }

    if (createdFeedstockIds.length > 0) {
      await cleanup(() =>
        db.delete(feedstocks).where(inArray(feedstocks.id, createdFeedstockIds)),
      );
    }

    if (createdBinIds.length > 0) {
      await cleanup(() =>
        db.delete(storageLocations).where(inArray(storageLocations.id, createdBinIds)),
      );
    }

    if (runId) {
      await cleanup(() => db.delete(productionRuns).where(eq(productionRuns.id, runId)));
    }
    if (createdSourceRunIds.length > 0) {
      await cleanup(() =>
        db
          .delete(productionRuns)
          .where(inArray(productionRuns.id, createdSourceRunIds)),
      );
    }
    if (reactorId) {
      await cleanup(() => db.delete(reactors).where(eq(reactors.id, reactorId)));
    }
    const formulationIds = [formulationAId, formulationBId].filter(
      (id): id is string => id != null,
    );
    if (formulationIngredientAId) {
      await cleanup(() =>
        db
          .delete(formulationIngredients)
          .where(eq(formulationIngredients.id, formulationIngredientAId)),
      );
    }
    if (formulationIds.length > 0) {
      await cleanup(() =>
        db.delete(formulations).where(inArray(formulations.id, formulationIds)),
      );
    }
    const feedstockTypeIds = [pyrolysisTypeId, blendTypeAId, blendTypeBId].filter(
      (id): id is string => id != null,
    );
    if (feedstockTypeIds.length > 0) {
      await cleanup(() => db.delete(feedstockTypes).where(inArray(feedstockTypes.id, feedstockTypeIds)));
    }
    if (facilityId) {
      await cleanup(() => db.delete(facilities).where(eq(facilities.id, facilityId)));
    }
  });

  async function makeProductBin(formulationId: string | null): Promise<string> {
    // Names must be unique per call, not per suite: storage locations are
    // unique on (facility_id, name) and each test creates its own bin.
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BIN-PBF-${suffix}`,
        name: `PBF Bin ${tag} ${suffix}`,
        type: "product_bin",
        facilityId,
        formulationId,
      })
      .returning({ id: storageLocations.id });
    createdBinIds.push(bin.id);
    return bin.id;
  }

  async function makeFeedstockBin(feedstockTypeId: string): Promise<string> {
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BIN-PBF-FS-${suffix}`,
        name: `PBF Feedstock Bin ${tag} ${suffix}`,
        type: "feedstock_bin",
        facilityId,
        feedstockTypeId,
      })
      .returning({ id: storageLocations.id });
    createdBinIds.push(bin.id);
    return bin.id;
  }

  async function makeBiocharBin(): Promise<string> {
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BIN-PBF-BC-${suffix}`,
        name: `PBF Biochar Bin ${tag} ${suffix}`,
        type: "biochar_bin",
        facilityId,
      })
      .returning({ id: storageLocations.id });
    createdBinIds.push(bin.id);
    return bin.id;
  }

  async function makeStockedFeedstockBin(
    massDryKg: number,
    massWetKg = massDryKg,
  ): Promise<string> {
    const binId = await makeFeedstockBin(blendTypeAId);
    await addCompletedFeedstock(binId, massDryKg, massWetKg);
    return binId;
  }

  async function addCompletedFeedstock(
    binId: string,
    massDryKg: number,
    massWetKg = massDryKg,
  ): Promise<void> {
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [feedstock] = await db
      .insert(feedstocks)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FS-PBF-${suffix}`,
        facilityId,
        status: "complete",
        feedstockTypeId: blendTypeAId,
        massDryKg,
        massWetKg,
        moistureContentPercent:
          massWetKg > 0 ? ((massWetKg - massDryKg) / massWetKg) * 100 : 0,
        storageLocationId: binId,
      })
      .returning({ id: feedstocks.id });
    createdFeedstockIds.push(feedstock.id);
  }

  function baseProductInput() {
    return {
      code: `BP-PBF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      facilityId,
      linkedProductionRunId: runId,
      massKg: 500,
      moistureContentPercent: 2,
      waterAddedKg: 0,
    };
  }

  /** Composition covering formulation A's single ingredient line. */
  function formulationAComposition() {
    return {
      ingredients: [
        {
          formulationIngredientId: formulationIngredientAId,
          feedstockTypeId: blendTypeAId,
          feedstockTypeName: "PBF Blend Type A",
          feedstockTypeCategory: "compost",
          ratio: 0.2,
          massKg: 0,
          storageLocationId: null as string | null,
        },
      ],
    };
  }

  it("claims an unassigned bin for the product's formulation on first use", async () => {
    const binId = await makeProductBin(null);

    const product = await createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
      ...baseProductInput(),
      formulationId: formulationAId,
      storageLocationId: binId,
      composition: formulationAComposition(),
    });
    createdProductIds.push(product.id);

    const [bin] = await db
      .select({ formulationId: storageLocations.formulationId })
      .from(storageLocations)
      .where(eq(storageLocations.id, binId));

    expect(bin.formulationId).toBe(formulationAId);
    // The recipe's biochar ratio is frozen onto the product at creation.
    expect(product.biocharRatio).toBe(0.6);
  });

  it("rejects a product whose formulation differs from the bin's reservation", async () => {
    const binId = await makeProductBin(formulationBId); // reserved for B

    await expect(
      createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
        ...baseProductInput(),
        formulationId: formulationAId, // mismatched
        storageLocationId: binId,
        composition: formulationAComposition(),
      })
    ).rejects.toThrow("reserved for a different formulation");
  });

  it("rejects a formulated product whose composition omits a recipe line", async () => {
    const binId = await makeProductBin(null);

    await expect(
      createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
        ...baseProductInput(),
        formulationId: formulationAId,
        storageLocationId: binId,
        // no composition — formulation A has one ingredient line
      })
    ).rejects.toThrow("must include every ingredient");
  });

  it("rejects duplicate rows for one formulation ingredient", async () => {
    const binId = await makeProductBin(null);
    const composition = formulationAComposition();

    await expect(
      createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
        ...baseProductInput(),
        formulationId: formulationAId,
        storageLocationId: binId,
        composition: {
          ingredients: [
            composition.ingredients[0],
            { ...composition.ingredients[0] },
          ],
        },
      }),
    ).rejects.toThrow("can only appear once");
  });

  it("creates a blend without requiring an ingredient source bin", async () => {
    const blendWetMassKg = 500;
    const sourceRunWetMassKg = 500;
    const sourceRunDryMassKg = 450;
    const sourceBinId = await makeBiocharBin();
    const productBinId = await makeProductBin(formulationAId);
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [sourceRun] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        code: `PR-PBF-OPTIONAL-INGREDIENT-BIN-${suffix}`,
        facilityId,
        reactorId,
        status: "complete",
        startTime: new Date("2026-02-03T08:00:00Z"),
        endTime: new Date("2026-02-03T12:00:00Z"),
        biocharStorageLocationId: sourceBinId,
        biocharOutputKg: sourceRunWetMassKg,
        biocharDryMassKg: sourceRunDryMassKg,
        biocharMoisturePercent: 10,
      })
      .returning({ id: productionRuns.id });
    createdSourceRunIds.push(sourceRun.id);

    const composition = formulationAComposition();
    composition.ingredients[0].massKg = 100;

    const product = await createBiocharProduct(
      makeTestOrgContext(TEST_USER_ID),
      {
        ...baseProductInput(),
        linkedProductionRunId: null,
        sourceBiocharStorageLocationId: sourceBinId,
        formulationId: formulationAId,
        storageLocationId: productBinId,
        massKg: blendWetMassKg,
        composition,
      },
    );
    createdProductIds.push(product.id);

    const [allocation] = await db
      .select({
        allocatedWetMassKg:
          biocharProductSourceAllocations.allocatedWetMassKg,
        allocatedDryMassKg:
          biocharProductSourceAllocations.allocatedDryMassKg,
      })
      .from(biocharProductSourceAllocations)
      .where(eq(biocharProductSourceAllocations.biocharProductId, product.id));

    expect(allocation).toMatchObject({
      allocatedWetMassKg: 400,
      allocatedDryMassKg: 360,
    });
    expect(product.composition).toMatchObject({
      ingredients: [
        expect.objectContaining({
          massKg: 100,
          massDryKg: null,
          moistureContentPercent: null,
          storageLocationId: null,
        }),
      ],
    });
  });

  it("allows a pure-biochar product in an unassigned bin and leaves it unclaimed", async () => {
    const binId = await makeProductBin(null);

    const product = await createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
      ...baseProductInput(),
      formulationId: null, // pure biochar
      storageLocationId: binId,
    });
    createdProductIds.push(product.id);

    const [bin] = await db
      .select({ formulationId: storageLocations.formulationId })
      .from(storageLocations)
      .where(eq(storageLocations.id, binId));

    expect(bin.formulationId).toBeNull();
    // Pure-biochar products carry no ratio snapshot (effective 1 via COALESCE).
    expect(product.biocharRatio).toBeNull();
  });

  it("rejects pyrolysis-usage feedstock bins as formulation ingredient bins", async () => {
    const productBinId = await makeProductBin(formulationAId);
    const pyrolysisBinId = await makeFeedstockBin(pyrolysisTypeId);

    await expect(
      createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
        ...baseProductInput(),
        formulationId: formulationAId,
        storageLocationId: productBinId,
        composition: {
          ingredients: [
            {
              formulationIngredientId: formulationIngredientAId,
              feedstockTypeId: blendTypeAId,
              feedstockTypeName: "Compost",
              feedstockTypeCategory: "compost",
              ratio: 0.2,
              massKg: 100,
              storageLocationId: pyrolysisBinId,
            },
          ],
        },
      })
    ).rejects.toThrow("Feedstock bin must hold blend-usage feedstock");
  });

  it("rejects blend ingredient bins whose held type differs from the formulation line", async () => {
    const productBinId = await makeProductBin(formulationAId);
    const wrongBlendBinId = await makeFeedstockBin(blendTypeBId);

    await expect(
      createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
        ...baseProductInput(),
        formulationId: formulationAId,
        storageLocationId: productBinId,
        composition: {
          ingredients: [
            {
              formulationIngredientId: formulationIngredientAId,
              feedstockTypeId: blendTypeAId,
              feedstockTypeName: "Compost",
              feedstockTypeCategory: "compost",
              ratio: 0.2,
              massKg: 100,
              storageLocationId: wrongBlendBinId,
            },
          ],
        },
      })
    ).rejects.toThrow("Feedstock bin must match the formulation material");
  });

  it("requires a wet-mass and moisture basis for an ingredient draw", async () => {
    const productBinId = await makeProductBin(formulationAId);
    const ingredientBinId = await makeFeedstockBin(blendTypeAId);
    const composition = formulationAComposition();
    composition.ingredients[0].massKg = 1;
    composition.ingredients[0].storageLocationId = ingredientBinId;

    await expect(
      createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
        ...baseProductInput(),
        formulationId: formulationAId,
        storageLocationId: productBinId,
        composition,
      }),
    ).rejects.toThrow("no complete wet-mass and moisture basis");
  });

  it("stores ingredient wet mass and deducts its frozen dry-mass basis", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const productBinId = await makeProductBin(formulationAId);
    const ingredientBinId = await makeStockedFeedstockBin(80, 100);
    const composition = formulationAComposition();
    composition.ingredients[0].massKg = 50;
    composition.ingredients[0].storageLocationId = ingredientBinId;

    const product = await createBiocharProduct(ctx, {
      ...baseProductInput(),
      formulationId: formulationAId,
      storageLocationId: productBinId,
      composition,
    });
    createdProductIds.push(product.id);

    const [ingredient] = (
      product.composition as {
        ingredients: Array<{
          massKg: number;
          massDryKg: number;
          moistureContentPercent: number;
        }>;
      }
    ).ingredients;
    expect(ingredient).toMatchObject({
      massKg: 50,
      massDryKg: 40,
      moistureContentPercent: 20,
    });

    const ingredientBin = await getEntityById(
      ctx,
      "storageLocation",
      ingredientBinId,
    );
    expect(ingredientBin?.subtitle).toContain("40 kg stored");
  });

  it("preserves a frozen ingredient basis when later intakes change bin moisture", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const productBinId = await makeProductBin(formulationAId);
    const ingredientBinId = await makeStockedFeedstockBin(80, 100);
    const composition = formulationAComposition();
    composition.ingredients[0].massKg = 50;
    composition.ingredients[0].storageLocationId = ingredientBinId;

    const product = await createBiocharProduct(ctx, {
      ...baseProductInput(),
      formulationId: formulationAId,
      storageLocationId: productBinId,
      composition,
    });
    createdProductIds.push(product.id);
    await addCompletedFeedstock(ingredientBinId, 100, 100);

    const updated = await updateBiocharProduct(ctx, product.id, {
      composition: product.composition as Record<string, unknown>,
    });
    const [ingredient] = (
      updated.composition as {
        ingredients: Array<{
          massDryKg: number;
          moistureContentPercent: number;
        }>;
      }
    ).ingredients;
    expect(ingredient).toMatchObject({
      massDryKg: 40,
      moistureContentPercent: 20,
    });

    const ingredientBin = await getEntityById(
      ctx,
      "storageLocation",
      ingredientBinId,
    );
    expect(ingredientBin?.subtitle).toContain("140 kg stored");
  });

  it("rejects an update that increases an ingredient draw beyond stock", async () => {
    const productBinId = await makeProductBin(formulationAId);
    const ingredientBinId = await makeStockedFeedstockBin(100);
    const composition = formulationAComposition();
    composition.ingredients[0].massKg = 60;
    composition.ingredients[0].storageLocationId = ingredientBinId;
    const product = await createBiocharProduct(
      makeTestOrgContext(TEST_USER_ID),
      {
        ...baseProductInput(),
        formulationId: formulationAId,
        storageLocationId: productBinId,
        composition,
      },
    );
    createdProductIds.push(product.id);

    const increased = formulationAComposition();
    increased.ingredients[0].massKg = 101;
    increased.ingredients[0].storageLocationId = ingredientBinId;
    await expect(
      updateBiocharProduct(makeTestOrgContext(TEST_USER_ID), product.id, {
        composition: increased,
      }),
    ).rejects.toThrow("Not enough feedstock in this bin");
  });

  it("serializes concurrent ingredient draws from the same bin", async () => {
    const ingredientBinId = await makeStockedFeedstockBin(100);
    const productBinIds = await Promise.all([
      makeProductBin(formulationAId),
      makeProductBin(formulationAId),
    ]);
    const create = (storageLocationId: string) => {
      const composition = formulationAComposition();
      composition.ingredients[0].massKg = 60;
      composition.ingredients[0].storageLocationId = ingredientBinId;
      return createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
        ...baseProductInput(),
        storageLocationId,
        formulationId: formulationAId,
        composition,
      });
    };

    const results = await Promise.allSettled(productBinIds.map(create));
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof create>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    createdProductIds.push(...fulfilled.map((result) => result.value.id));

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(Error);
    expect(rejected[0].reason.message).toBe("Not enough feedstock in this bin");

    const ingredientBin = await getEntityById(
      makeTestOrgContext(TEST_USER_ID),
      "storageLocation",
      ingredientBinId,
    );
    expect(ingredientBin?.subtitle).toContain("40 kg stored");
  });

  it("withdraws recorded source mass, keeps allocations immutable, and blocks overdraw", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const sourceBinId = await makeBiocharBin();
    const ingredientBinId = await makeStockedFeedstockBin(40);
    const [firstProductBinId, secondProductBinId] = await Promise.all([
      makeProductBin(formulationAId),
      makeProductBin(formulationAId),
    ]);
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [sourceRun] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        code: `PR-PBF-SOURCE-${suffix}`,
        facilityId,
        reactorId,
        status: "complete",
        startTime: new Date("2026-02-01T08:00:00Z"),
        endTime: new Date("2026-02-01T12:00:00Z"),
        biocharStorageLocationId: sourceBinId,
        biocharOutputKg: 80,
        biocharDryMassKg: 72,
        biocharMoisturePercent: 10,
      })
      .returning({ id: productionRuns.id });
    createdSourceRunIds.push(sourceRun.id);

    const composition = formulationAComposition();
    composition.ingredients[0].massKg = 20;
    composition.ingredients[0].storageLocationId = ingredientBinId;
    const product = await createBiocharProduct(ctx, {
      ...baseProductInput(),
      linkedProductionRunId: null,
      sourceBiocharStorageLocationId: sourceBinId,
      formulationId: formulationAId,
      storageLocationId: firstProductBinId,
      massKg: 100,
      composition,
    });
    createdProductIds.push(product.id);

    const allocations = await db
      .select({
        allocatedWetMassKg:
          biocharProductSourceAllocations.allocatedWetMassKg,
        allocatedDryMassKg:
          biocharProductSourceAllocations.allocatedDryMassKg,
      })
      .from(biocharProductSourceAllocations)
      .where(
        eq(biocharProductSourceAllocations.biocharProductId, product.id),
      );
    expect(product.massKg).toBe(100);
    expect(product.biocharRatio).toBe(0.6);
    expect(allocations).toEqual([
      { allocatedWetMassKg: 80, allocatedDryMassKg: 72 },
    ]);
    await expect(
      getStockAvailability(ctx, {
        kind: "biocharProduct",
        sourceBiocharStorageLocationId: sourceBinId,
      }),
    ).resolves.toEqual({ availableKg: 0 });

    const metadataRefreshedComposition = {
      ingredients: [
        {
          massKg: 20,
          massDryKg: 20,
          moistureContentPercent: 0,
          storageLocationId: ingredientBinId,
          ratio: 0.9,
          feedstockTypeCategory: "refreshed-category",
          feedstockTypeName: "Refreshed display name",
          feedstockTypeId: blendTypeAId,
          formulationIngredientId: formulationIngredientAId,
        },
      ],
    };
    await expect(
      updateBiocharProduct(ctx, product.id, {
        composition: metadataRefreshedComposition,
      }),
    ).resolves.toMatchObject({ id: product.id });
    await expect(
      db
        .select({
          allocatedWetMassKg:
            biocharProductSourceAllocations.allocatedWetMassKg,
        })
        .from(biocharProductSourceAllocations)
        .where(
          eq(biocharProductSourceAllocations.biocharProductId, product.id),
        ),
    ).resolves.toEqual([{ allocatedWetMassKg: 80 }]);

    await updateFormulation(ctx, formulationAId, { biocharRatio: 0.7 });
    try {
      await expect(
        db
          .select({
            allocatedWetMassKg:
              biocharProductSourceAllocations.allocatedWetMassKg,
            allocatedDryMassKg:
              biocharProductSourceAllocations.allocatedDryMassKg,
          })
          .from(biocharProductSourceAllocations)
          .where(
            eq(biocharProductSourceAllocations.biocharProductId, product.id),
          ),
      ).resolves.toEqual([
        { allocatedWetMassKg: 80, allocatedDryMassKg: 72 },
      ]);
      await expect(
        getStockAvailability(ctx, {
          kind: "biocharProduct",
          sourceBiocharStorageLocationId: sourceBinId,
        }),
      ).resolves.toEqual({ availableKg: 0 });
    } finally {
      await updateFormulation(ctx, formulationAId, { biocharRatio: 0.6 });
    }

    const changedComposition = formulationAComposition();
    changedComposition.ingredients[0].massKg = 25;
    changedComposition.ingredients[0].storageLocationId = ingredientBinId;
    await expect(
      updateBiocharProduct(ctx, product.id, {
        composition: changedComposition,
      }),
    ).rejects.toThrow("source allocation is fixed");
    await expect(
      db
        .select({
          allocatedWetMassKg:
            biocharProductSourceAllocations.allocatedWetMassKg,
        })
        .from(biocharProductSourceAllocations)
        .where(
          eq(biocharProductSourceAllocations.biocharProductId, product.id),
        ),
    ).resolves.toEqual([{ allocatedWetMassKg: 80 }]);

    const overdrawComposition = formulationAComposition();
    overdrawComposition.ingredients[0].massKg = 5;
    overdrawComposition.ingredients[0].storageLocationId = ingredientBinId;
    await expect(
      createBiocharProduct(ctx, {
        ...baseProductInput(),
        linkedProductionRunId: null,
        sourceBiocharStorageLocationId: sourceBinId,
        formulationId: formulationAId,
        storageLocationId: secondProductBinId,
        massKg: 10,
        composition: overdrawComposition,
      }),
    ).rejects.toThrow("Not enough biochar in this bin");
  });

  it("allows an all-ingredient product with zero required source mass", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const sourceBinId = await makeBiocharBin();
    const productBinId = await makeProductBin(formulationAId);
    const ingredientBinId = await makeStockedFeedstockBin(100);
    const composition = formulationAComposition();
    composition.ingredients[0].massKg = 100;
    composition.ingredients[0].storageLocationId = ingredientBinId;

    const product = await createBiocharProduct(ctx, {
      ...baseProductInput(),
      linkedProductionRunId: null,
      sourceBiocharStorageLocationId: sourceBinId,
      formulationId: formulationAId,
      storageLocationId: productBinId,
      massKg: 100,
      composition,
    });
    createdProductIds.push(product.id);

    await expect(
      db
        .select()
        .from(biocharProductSourceAllocations)
        .where(
          eq(biocharProductSourceAllocations.biocharProductId, product.id),
        ),
    ).resolves.toEqual([]);
  });

  it("updates legacy blend mass without requiring a missing ingredient bin", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const sourceBinId = await makeBiocharBin();
    const productBinId = await makeProductBin(formulationAId);
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [sourceRun] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        code: `PR-PBF-LEGACY-${suffix}`,
        facilityId,
        reactorId,
        status: "complete",
        startTime: new Date("2026-02-02T08:00:00Z"),
        endTime: new Date("2026-02-02T12:00:00Z"),
        biocharStorageLocationId: sourceBinId,
        biocharOutputKg: 100,
        biocharDryMassKg: 90,
        biocharMoisturePercent: 10,
      })
      .returning({ id: productionRuns.id });
    createdSourceRunIds.push(sourceRun.id);

    const [legacyProduct] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BP-PBF-LEGACY-${suffix}`,
        facilityId,
        linkedProductionRunId: sourceRun.id,
        formulationId: formulationAId,
        storageLocationId: productBinId,
        massKg: 50,
        moistureContentPercent: 2,
        waterAddedKg: 0,
        composition: {
          ingredients: [
            {
              formulationIngredientId: formulationIngredientAId,
              feedstockTypeId: blendTypeAId,
              massKg: 20,
              storageLocationId: null,
            },
          ],
        },
      })
      .returning({ id: biocharProducts.id });
    createdProductIds.push(legacyProduct.id);

    await expect(
      updateBiocharProduct(ctx, legacyProduct.id, { massKg: 60 }),
    ).resolves.toMatchObject({ massKg: 60 });
  });

  it("keeps the snapshot ratio when the formulation's live ratio changes", async () => {
    const binId = await makeProductBin(null);
    const product = await createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
      ...baseProductInput(),
      formulationId: formulationAId,
      storageLocationId: binId,
      composition: formulationAComposition(),
    });
    createdProductIds.push(product.id);
    expect(product.biocharRatio).toBe(0.6);

    // Recipe edit AFTER the product exists — the frozen snapshot must not move.
    await db
      .update(formulations)
      .set({ biocharRatio: 0.9 })
      .where(eq(formulations.id, formulationAId));
    try {
      const [row] = await db
        .select({ biocharRatio: biocharProducts.biocharRatio })
        .from(biocharProducts)
        .where(eq(biocharProducts.id, product.id));
      expect(row.biocharRatio).toBe(0.6);

      // An unrelated field update must not re-derive the snapshot either.
      await updateBiocharProduct(makeTestOrgContext(TEST_USER_ID), product.id, {
        moistureContentPercent: 5,
      });
      const [afterUpdate] = await db
        .select({ biocharRatio: biocharProducts.biocharRatio })
        .from(biocharProducts)
        .where(eq(biocharProducts.id, product.id));
      expect(afterUpdate.biocharRatio).toBe(0.6);
    } finally {
      await db
        .update(formulations)
        .set({ biocharRatio: 0.6 })
        .where(eq(formulations.id, formulationAId));
    }
  });

  it("re-snapshots the ratio when the product is reassigned to another formulation", async () => {
    const binId = await makeProductBin(null);
    const product = await createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
      ...baseProductInput(),
      formulationId: formulationAId,
      storageLocationId: binId,
      composition: formulationAComposition(),
    });
    createdProductIds.push(product.id);
    expect(product.biocharRatio).toBe(0.6);

    // Reassign to formulation B (ratio 0.4, no recipe lines) in a fresh bin.
    const binBId = await makeProductBin(null);
    await updateBiocharProduct(makeTestOrgContext(TEST_USER_ID), product.id, {
      formulationId: formulationBId,
      storageLocationId: binBId,
      composition: { ingredients: [] },
    });

    const [row] = await db
      .select({ biocharRatio: biocharProducts.biocharRatio })
      .from(biocharProducts)
      .where(eq(biocharProducts.id, product.id));
    expect(row.biocharRatio).toBe(0.4);
  });
});
