import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeBiocharProductInput, updateBiocharProductInput } from "./biochar-product-input";
import { createFeedstockSchema, deleteFeedstockSchema, updateFeedstockSchema } from "./feedstocks";
import { uuidSchema } from "./helpers";
import { recordOutputStockMovementInput } from "./output-stock-movement-input";
import { createProductionRunInput, updateProductionRunInput } from "./production-run-input";
import { deleteProductionRunSchema } from "./production-runs";

const UPPER = "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11";
const LOWER = UPPER.toLowerCase();
const INSTANT = "2026-10-06T08:00:00.000Z";

/** Parses `input` and returns its output as JSON, so a test can look for either spelling anywhere in it. */
function parsedJson(schema: z.ZodType, input: unknown): string {
  const parsed = schema.safeParse(input);
  expect(parsed.error?.issues).toBeUndefined();
  return JSON.stringify(parsed.data);
}

describe("uuidSchema (api/uuid-case)", () => {
  it("accepts either case and returns lowercase", () => {
    expect(uuidSchema().parse(UPPER)).toBe(LOWER);
    expect(uuidSchema().parse(LOWER)).toBe(LOWER);
    expect(uuidSchema("Choose a bin.").safeParse("BIN-1").error?.issues[0].message).toBe("Choose a bin.");
  });

  it("publishes the same JSON Schema as a plain UUID", () => {
    expect(z.toJSONSchema(uuidSchema(), { io: "input" })).toEqual(z.toJSONSchema(z.uuid(), { io: "input" }));
  });
});

describe("published write inputs lowercase every UUID they take", () => {
  it.each([
    ["feedstock create", createFeedstockSchema, {
      facilityId: UPPER, deliveryDate: "2026-10-06", supplierId: UPPER, vehicleId: UPPER, feedstockTypeId: UPPER,
      totalWetMassKg: 100, moisturePercent: 10, allocations: [{ storageLocationId: UPPER, allocatedWetMassKg: 100 }],
    }],
    ["feedstock update", updateFeedstockSchema, {
      feedstockId: UPPER, expectedVersion: 1, facilityId: UPPER, supplierId: UPPER, vehicleId: UPPER, feedstockTypeId: UPPER, storageLocationId: UPPER,
    }],
    ["feedstock delete", deleteFeedstockSchema, { feedstockId: UPPER, expectedVersion: 1 }],
    ["production run create", createProductionRunInput, {
      facilityId: UPPER, reactorId: UPPER, status: "running", startTime: INSTANT, operatorId: UPPER, biocharStorageLocationId: UPPER,
      feedstockDraws: [{ storageLocationId: UPPER, wetMassKg: 10 }],
    }],
    ["production run update", updateProductionRunInput, {
      productionRunId: UPPER, expectedVersion: 1, facilityId: UPPER, reactorId: UPPER, operatorId: UPPER, biocharStorageLocationId: UPPER,
      feedstockDraws: [{ storageLocationId: UPPER, wetMassKg: 10 }],
    }],
    ["production run delete", deleteProductionRunSchema, { productionRunId: UPPER, expectedVersion: 1 }],
    ["product create", makeBiocharProductInput, {
      facilityId: UPPER, formulationId: UPPER, placedAt: INSTANT, sourceBiocharStorageLocationId: UPPER, storageLocationId: UPPER,
      biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0,
      ingredients: [{ formulationIngredientId: UPPER, storageLocationId: UPPER, wetMassKg: 5, moisturePercent: 20 }],
    }],
    ["product create from sub-bins", makeBiocharProductInput, {
      facilityId: UPPER, formulationId: UPPER, placedAt: INSTANT, sourceBiocharStorageLocationId: UPPER, storageLocationId: UPPER,
      biocharWetMassKg: 100, waterAddedKg: 0, sources: [{ layerId: UPPER, moisturePercent: 10 }],
    }],
    ["product update", updateBiocharProductInput, { biocharProductId: UPPER, expectedVersion: 1, status: "ready" }],
    ["stock movement", recordOutputStockMovementInput, {
      storageLocationId: UPPER, kind: "loss", occurredAt: INSTANT, wetMassKg: 10, sources: [{ layerId: UPPER, moisturePercent: 10 }], reason: "Spilled",
    }],
  ] as const)("%s", (_name, schema, input) => {
    const json = parsedJson(schema, input);
    expect(json).not.toContain(UPPER);
    expect(json).toContain(LOWER);
  });

  it("finds a duplicate run draw bin whatever case each line uses", () => {
    const parsed = createProductionRunInput.safeParse({
      facilityId: LOWER, reactorId: LOWER, status: "running", startTime: INSTANT,
      feedstockDraws: [{ storageLocationId: UPPER, wetMassKg: 10 }, { storageLocationId: LOWER, wetMassKg: 10 }],
    });
    expect(parsed.error?.issues).toContainEqual(expect.objectContaining({ path: ["feedstockDraws", 1, "storageLocationId"] }));
  });
});
