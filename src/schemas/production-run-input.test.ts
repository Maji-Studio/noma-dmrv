import { expect, it } from "vitest";
import { createProductionRunInput, updateProductionRunInput } from "./production-run-input";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { rejectUnknownFields } from "@/lib/api/unknown-fields";
import { MASS_INPUT_MAX_KG } from "./helpers";

const id = "00000000-0000-4000-8000-000000000001";
const numericFields = ["feedstockMoisturePercent", "feedingRateKgHr", "residenceTimeMinutes", "dieselOperationLiters", "dieselGensetLiters", "preprocessingFuelLiters", "electricityKwh", "biocharOutputKg", "biocharMoisturePercent"] as const;
const inputs = [
  { name: "create", schema: createProductionRunInput, base: { facilityId: id, reactorId: id, startTime: "2026-01-01T10:00:00Z" } },
  { name: "update", schema: updateProductionRunInput, base: { productionRunId: id, expectedVersion: 1 } },
];
it.each(inputs)("rejects legacy feedstock keys as unknown fields for $name", ({ schema, base }) => {
  const contract = toOperationJsonSchema(schema);
  for (const [field, value] of [["feedstockStorageLocationId", id], ["feedstockWetMassKg", 100]] as const) {
    const input = { ...base, [field]: value };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "unrecognized_keys", keys: [field] }),
    );
    expect(() => rejectUnknownFields(input, contract)).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ path: [field] })] }),
    );
  }
});

it.each(inputs)("accepts numeric form encodings and preserves omission for $name", ({ schema, base }) => {
  for (const field of numericFields) {
    const value = field === "residenceTimeMinutes" ? 12 : 12.5;
    expect(schema.parse({ ...base, [field]: String(value) })).toHaveProperty(field, value);
    for (const empty of ["", "  ", null]) expect(schema.parse({ ...base, [field]: empty })).toHaveProperty(field, null);
    expect(schema.parse(base)[field]).toBeUndefined();
    expect(schema.safeParse({ ...base, [field]: "12abc" }).success).toBe(false);
  }
  expect(schema.parse({ ...base, electricityKwh: "0" }).electricityKwh).toBe(0);
  expect(schema.safeParse({ ...base, residenceTimeMinutes: "12.5" }).success).toBe(false);
  expect(schema.safeParse({ ...base, feedstockMoisturePercent: "101" }).success).toBe(false);
  expect(schema.safeParse({ ...base, biocharOutputKg: "0.0001" }).success).toBe(false);
});
it.each(inputs)("keeps draw checks for coerced masses and canonical published numbers", ({ schema, base }) => {
  expect(schema.parse({ ...base, feedstockDraws: [{ storageLocationId: id, wetMassKg: "12.5" }] }).feedstockDraws?.[0].wetMassKg).toBe(12.5);
  expect(schema.safeParse({ ...base, mystery: 1 }).success).toBe(false);
  expect(schema.safeParse({ ...base, feedstockDraws: [{ storageLocationId: id, wetMassKg: String(MASS_INPUT_MAX_KG) }, { storageLocationId: "00000000-0000-4000-8000-000000000002", wetMassKg: "1" }] }).success).toBe(false);
  expect(schema.safeParse({ ...base, feedstockDraws: [{ storageLocationId: id, wetMassKg: "1" }, { storageLocationId: id, wetMassKg: "1" }] }).success).toBe(false);
  const contract = toOperationJsonSchema(schema);
  expect(() => rejectUnknownFields({ ...base, feedstockDraws: [{ storageLocationId: id, wetMassKg: "12.5", mystery: true }] }, contract))
    .toThrow(expect.objectContaining({ issues: [expect.objectContaining({ path: ["feedstockDraws", 0, "mystery"] })] }));
  expect(() => rejectUnknownFields({ ...base, electricityKwh: "12.5" }, contract)).not.toThrow();
  const published = contract.properties as Record<string, unknown>;
  expect(JSON.stringify(published.residenceTimeMinutes)).toContain('"type":"integer"');
  for (const field of numericFields) {
    expect(JSON.stringify(published[field])).toMatch(/"type":"(number|integer)"/);
    expect(JSON.stringify(published[field])).not.toContain('"type":"string"');
  }
});


it.each(inputs)("publishes conditional output requirements for $name", ({ schema }) => {
  const contract = toOperationJsonSchema(schema);
  const fields = contract.properties as Record<string, { description: string }>;
  expect(fields.biocharStorageLocationId.description).toContain("Required when complete");
  expect(fields.biocharMoisturePercent.description).toContain("Required when complete");
  expect(fields.biocharOutputKg.description).toContain("Must be positive when complete");
});
