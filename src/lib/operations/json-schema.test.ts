import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFeedstockSchema, updateFeedstockSchema } from "@/schemas/feedstocks";
import { createProductionRunSchema } from "@/schemas/production-runs";
import {
  MASS_INPUT_MAX_KG,
  MASS_KG_INPUT_STEP,
  STORED_PERCENT_INPUT_STEP,
  optionalPositiveNumber,
  requiredPositiveMassKgSchema,
} from "@/schemas/helpers";
import { toOperationJsonSchema, type JsonSchema } from "./json-schema";

/** Drop keys a hand-written expectation should not have to spell out. */
function contract(schema: z.ZodType): JsonSchema {
  return JSON.parse(
    JSON.stringify(toOperationJsonSchema(schema), (key, value) =>
      key === "pattern" || key === "$schema" ? undefined : value,
    ),
  );
}

const UUID = { type: "string", format: "uuid" };
const REQUIRED_UUID = { type: "string", minLength: 1, format: "uuid" };
const NULLABLE_UUID = { anyOf: [UUID, { type: "null" }] };
const POSITIVE_MASS_KG = {
  type: "number",
  exclusiveMinimum: 0,
  maximum: MASS_INPUT_MAX_KG,
  multipleOf: MASS_KG_INPUT_STEP,
};
const PERCENT = {
  type: "number",
  minimum: 0,
  maximum: 100,
  multipleOf: STORED_PERCENT_INPUT_STEP,
};
const DISTANCE_KM = { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] };
const DISTANCE_SOURCE = {
  anyOf: [
    { type: "string", enum: ["map_estimate", "manual", "document"] },
    { type: "null" },
  ],
};
const TEXT_2000 = { type: "string", maxLength: 2000 };

describe("toOperationJsonSchema: shared helpers", () => {
  it("keeps the bounds of a piped mass helper", () => {
    expect(contract(requiredPositiveMassKgSchema())).toEqual(POSITIVE_MASS_KG);
  });

  it("does not advertise an optional preprocess as required", () => {
    expect(contract(z.object({ distance: optionalPositiveNumber }))).toEqual({
      type: "object",
      properties: { distance: DISTANCE_KM },
    });
  });

  it("publishes an instant as an RFC 3339 date-time", () => {
    expect(contract(z.object({ at: z.date() }))).toEqual({
      type: "object",
      properties: { at: { type: "string", format: "date-time" } },
      required: ["at"],
    });
  });

  it("is deterministic", () => {
    expect(toOperationJsonSchema(createFeedstockSchema)).toEqual(
      toOperationJsonSchema(createFeedstockSchema),
    );
  });
});

describe("toOperationJsonSchema: feedstock intake", () => {
  it("publishes the create contract", () => {
    expect(contract(createFeedstockSchema)).toEqual({
      type: "object",
      properties: {
        facilityId: REQUIRED_UUID,
        deliveryDate: { type: "string", format: "date" },
        supplierId: REQUIRED_UUID,
        vehicleId: NULLABLE_UUID,
        transportDistanceKm: DISTANCE_KM,
        transportDistanceSource: DISTANCE_SOURCE,
        feedstockTypeId: REQUIRED_UUID,
        totalWetMassKg: POSITIVE_MASS_KG,
        moisturePercent: PERCENT,
        allocations: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              storageLocationId: REQUIRED_UUID,
              allocatedWetMassKg: POSITIVE_MASS_KG,
            },
            required: ["storageLocationId", "allocatedWetMassKg"],
          },
        },
        overrideJustification: TEXT_2000,
        notes: TEXT_2000,
      },
      required: [
        "facilityId",
        "deliveryDate",
        "supplierId",
        "feedstockTypeId",
        "totalWetMassKg",
        "moisturePercent",
        "allocations",
      ],
    });
  });

  it("publishes the update contract with only the id required", () => {
    expect(contract(updateFeedstockSchema)).toEqual({
      type: "object",
      properties: {
        feedstockId: UUID,
        expectedUpdatedAt: { type: "string", format: "date-time" },
        facilityId: UUID,
        deliveryDate: { type: "string", format: "date" },
        supplierId: UUID,
        vehicleId: NULLABLE_UUID,
        transportDistanceKm: DISTANCE_KM,
        transportDistanceSource: DISTANCE_SOURCE,
        feedstockTypeId: UUID,
        massWetKg: POSITIVE_MASS_KG,
        moistureContentPercent: PERCENT,
        massDryKg: {
          type: "number",
          minimum: 0,
          maximum: MASS_INPUT_MAX_KG,
          multipleOf: MASS_KG_INPUT_STEP,
        },
        storageLocationId: NULLABLE_UUID,
        overrideJustification: { anyOf: [TEXT_2000, { type: "null" }] },
        notes: { anyOf: [TEXT_2000, { type: "null" }] },
      },
      required: ["feedstockId"],
    });
  });
});

describe("toOperationJsonSchema: production run", () => {
  const generated = contract(createProductionRunSchema);
  const properties = generated.properties as Record<string, JsonSchema>;

  it("requires only what the runtime requires", () => {
    expect(generated.required).toEqual([
      "facilityId",
      "reactorId",
      "startDate",
      "startTime",
    ]);
  });

  it("keeps mass, percent and integer bounds", () => {
    expect(properties.feedstockDraws).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: {
          storageLocationId: REQUIRED_UUID,
          wetMassKg: POSITIVE_MASS_KG,
        },
        required: ["storageLocationId", "wetMassKg"],
      },
    });
    expect(properties.biocharOutputKg).toEqual({
      anyOf: [
        { type: "number", minimum: 0, maximum: MASS_INPUT_MAX_KG, multipleOf: MASS_KG_INPUT_STEP },
        { type: "null" },
      ],
    });
    expect(properties.biocharMoisturePercent).toMatchObject({
      multipleOf: STORED_PERCENT_INPUT_STEP,
      anyOf: [{ type: "number", minimum: 0, maximum: 100 }, { type: "null" }],
    });
    expect(properties.residenceTimeMinutes).toEqual({
      anyOf: [
        { type: "integer", exclusiveMinimum: 0, maximum: 2_147_483_647 },
        { type: "null" },
      ],
    });
  });

  it("publishes the status enum", () => {
    expect(properties.status).toEqual({
      type: "string",
      default: "draft",
      enum: ["draft", "running", "complete", "failed", "cancelled"],
    });
  });
});
