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
import { createBiocharProduct } from "@/data-access/biochar-products";
import { facilities, reactors, storageLocations } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionRuns } from "@/db/schema/production";
import { biocharProducts, formulations } from "@/db/schema/products";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

describe("createBiocharProduct — product bin ↔ formulation", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  let facilityId: string;
  let reactorId: string;
  let runId: string;
  let formulationAId: string;
  let formulationBId: string;
  let pyrolysisTypeId: string;
  const createdBinIds: string[] = [];
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    const [facility] = await db
      .insert(facilities)
      .values({ code: `FAC-PBF-${tag}`, name: `PBF Facility ${tag}` })
      .returning({ id: facilities.id });
    facilityId = facility.id;

    const [reactor] = await db
      .insert(reactors)
      .values({
        code: `R-PBF-${tag}`,
        identifier: `PBF Reactor ${tag}`,
        facilityId,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    reactorId = reactor.id;

    const [run] = await db
      .insert(productionRuns)
      .values({ code: `PR-PBF-${tag}`, facilityId, reactorId, date: "2026-01-01", status: "complete" })
      .returning({ id: productionRuns.id });
    runId = run.id;

    const [formulationA] = await db
      .insert(formulations)
      .values({ code: `FM-PBF-A-${tag}`, name: `PBF Blend A ${tag}`, biocharRatio: 0.6 })
      .returning({ id: formulations.id });
    formulationAId = formulationA.id;

    const [formulationB] = await db
      .insert(formulations)
      .values({ code: `FM-PBF-B-${tag}`, name: `PBF Blend B ${tag}`, biocharRatio: 0.4 })
      .returning({ id: formulations.id });
    formulationBId = formulationB.id;

    const [pyrolysisType] = await db
      .insert(feedstockTypes)
      .values({
        code: `FT-PBF-P-${tag}`,
        name: `PBF Pyrolysis Type ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    pyrolysisTypeId = pyrolysisType.id;
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

    if (createdBinIds.length > 0) {
      await cleanup(() =>
        db.delete(storageLocations).where(inArray(storageLocations.id, createdBinIds)),
      );
    }

    if (runId) {
      await cleanup(() => db.delete(productionRuns).where(eq(productionRuns.id, runId)));
    }
    if (reactorId) {
      await cleanup(() => db.delete(reactors).where(eq(reactors.id, reactorId)));
    }
    const formulationIds = [formulationAId, formulationBId].filter(
      (id): id is string => id != null,
    );
    if (formulationIds.length > 0) {
      await cleanup(() =>
        db.delete(formulations).where(inArray(formulations.id, formulationIds)),
      );
    }
    if (pyrolysisTypeId) {
      await cleanup(() => db.delete(feedstockTypes).where(eq(feedstockTypes.id, pyrolysisTypeId)));
    }
    if (facilityId) {
      await cleanup(() => db.delete(facilities).where(eq(facilities.id, facilityId)));
    }
  });

  async function makeProductBin(formulationId: string | null): Promise<string> {
    const [bin] = await db
      .insert(storageLocations)
      .values({
        code: `BIN-PBF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        name: `PBF Bin ${tag}`,
        type: "product_bin",
        facilityId,
        formulationId,
      })
      .returning({ id: storageLocations.id });
    createdBinIds.push(bin.id);
    return bin.id;
  }

  async function makeFeedstockBin(feedstockTypeId: string): Promise<string> {
    const [bin] = await db
      .insert(storageLocations)
      .values({
        code: `BIN-PBF-FS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        name: `PBF Feedstock Bin ${tag}`,
        type: "feedstock_bin",
        facilityId,
        feedstockTypeId,
      })
      .returning({ id: storageLocations.id });
    createdBinIds.push(bin.id);
    return bin.id;
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

  it("claims an unassigned bin for the product's formulation on first use", async () => {
    const binId = await makeProductBin(null);

    const product = await createBiocharProduct(TEST_USER_ID, {
      ...baseProductInput(),
      formulationId: formulationAId,
      storageLocationId: binId,
    });
    createdProductIds.push(product.id);

    const [bin] = await db
      .select({ formulationId: storageLocations.formulationId })
      .from(storageLocations)
      .where(eq(storageLocations.id, binId));

    expect(bin.formulationId).toBe(formulationAId);
  });

  it("rejects a product whose formulation differs from the bin's reservation", async () => {
    const binId = await makeProductBin(formulationBId); // reserved for B

    await expect(
      createBiocharProduct(TEST_USER_ID, {
        ...baseProductInput(),
        formulationId: formulationAId, // mismatched
        storageLocationId: binId,
      })
    ).rejects.toThrow("reserved for a different formulation");
  });

  it("allows a pure-biochar product in an unassigned bin and leaves it unclaimed", async () => {
    const binId = await makeProductBin(null);

    const product = await createBiocharProduct(TEST_USER_ID, {
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
  });

  it("rejects pyrolysis-usage feedstock bins as formulation ingredient bins", async () => {
    const productBinId = await makeProductBin(formulationAId);
    const pyrolysisBinId = await makeFeedstockBin(pyrolysisTypeId);

    await expect(
      createBiocharProduct(TEST_USER_ID, {
        ...baseProductInput(),
        formulationId: formulationAId,
        storageLocationId: productBinId,
        composition: {
          ingredients: [
            {
              formulationIngredientId: crypto.randomUUID(),
              ingredientName: "Pyrolysis-only stock",
              ingredientType: "biomass",
              ratio: 0.2,
              massKg: 100,
              storageLocationId: pyrolysisBinId,
            },
          ],
        },
      })
    ).rejects.toThrow("Ingredient bin must hold blend-usage feedstock");
  });
});
