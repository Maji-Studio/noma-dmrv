import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFeedstockSchema, updateFeedstockSchema } from "@/schemas/feedstocks";
import { createProductionRunSchema } from "@/schemas/production-runs";
import { recordLabSampleInput, updateLabSampleApiInput } from "@/schemas/lab-sample-input";
import {
  MASS_INPUT_MAX_KG,
  MASS_KG_INPUT_STEP,
  RATIO_INPUT_MAX,
  STORED_PERCENT_INPUT_STEP,
  optionalPositiveNumber,
  requiredPositiveMassKgSchema,
} from "@/schemas/helpers";
import { toOperationJsonSchema, type JsonSchema } from "./json-schema";

/** Drop keys a hand-written expectation should not have to spell out. */
function contract(schema: z.ZodType): JsonSchema {
  return JSON.parse(
    JSON.stringify(toOperationJsonSchema(schema), (key, value) =>
      key === "description" || key === "pattern" || key === "$schema" ? undefined : value,
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
const INTAKE_MOISTURE_PERCENT = {
  type: "number",
  minimum: 0,
  exclusiveMaximum: 100,
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

  it("preserves schema descriptions when publishing calendar dates and instants", () => {
    const schema = createFeedstockSchema.shape.deliveryDate;
    expect(toOperationJsonSchema(schema)).toMatchObject({ format: "date", description: schema.description });
    expect(toOperationJsonSchema(z.date().describe("Recorded instant, RFC 3339."))).toMatchObject({ format: "date-time", description: "Recorded instant, RFC 3339." });
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
        moisturePercent: INTAKE_MOISTURE_PERCENT,
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

  it("publishes the update contract with the id and version required", () => {
    expect(contract(updateFeedstockSchema)).toEqual({
      type: "object",
      properties: {
        feedstockId: UUID,
        expectedVersion: { type: "integer", exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        facilityId: UUID,
        deliveryDate: { type: "string", format: "date" },
        supplierId: UUID,
        vehicleId: NULLABLE_UUID,
        transportDistanceKm: DISTANCE_KM,
        transportDistanceSource: DISTANCE_SOURCE,
        feedstockTypeId: UUID,
        massWetKg: POSITIVE_MASS_KG,
        moistureContentPercent: INTAKE_MOISTURE_PERCENT,
        storageLocationId: UUID,
        overrideJustification: { anyOf: [TEXT_2000, { type: "null" }] },
        notes: { anyOf: [TEXT_2000, { type: "null" }] },
      },
      required: ["feedstockId", "expectedVersion"],
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
      anyOf: [{ type: "number", minimum: 0, exclusiveMaximum: 100 }, { type: "null" }],
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
      default: "running",
      enum: ["running", "complete"],
    });
  });
});

describe("toOperationJsonSchema: lab sample", () => {
  const created = contract(recordLabSampleInput);
  const createProperties = created.properties as Record<string, JsonSchema>;
  const patched = contract(updateLabSampleApiInput);
  const patchProperties = patched.properties as Record<string, JsonSchema>;
  const NULLABLE_PERCENT = { minimum: 0, maximum: 100, anyOf: [{ type: "number" }, { type: "null" }] };

  it("requires the batch, sampling time and both carbon figures, and nothing else", () => {
    expect(created.required).toEqual(["creditBatchId", "samplingTime", "totalCarbonPercent", "organicCarbonPercent"]);
    expect(created.additionalProperties).toBe(false);
    expect(patched.required).toBeUndefined();
    expect(patched.additionalProperties).toBe(false);
  });

  it("publishes neither the calculated H/C_org nor the form-only and file fields", () => {
    for (const field of ["hToCOrgRatio", "durabilityOption", "nutrientClaimEnabled", "r0HistogramFileUrl", "tgaThermogramFileUrl", "arsenicMgKg", "sampleCode"]) {
      expect(createProperties).not.toHaveProperty(field);
      expect(patchProperties).not.toHaveProperty(field);
    }
    expect(createProperties).not.toHaveProperty("code");
    expect(patchProperties.code).toEqual({ type: "string", minLength: 1, maxLength: 50 });
  });

  it("publishes ids, instants, calendar dates and bounded numbers", () => {
    expect(createProperties.creditBatchId).toEqual(UUID);
    expect(patchProperties.creditBatchId).toEqual(UUID);
    expect(createProperties.samplingTime.anyOf).toEqual([
      { type: "string", format: "date-time" },
      expect.objectContaining({ type: "object", required: ["date", "time"], additionalProperties: false }),
    ]);
    expect(createProperties.analysisDate).toEqual({ anyOf: [{ type: "string", format: "date" }, { type: "null" }] });
    expect(createProperties.totalCarbonPercent).toEqual({ type: "number", minimum: 0, maximum: 100 });
    expect(patchProperties.totalCarbonPercent).toEqual({ type: "number", minimum: 0, maximum: 100 });
    expect(createProperties.totalHydrogenPercent).toEqual(NULLABLE_PERCENT);
    expect(patchProperties.totalHydrogenPercent).toEqual(NULLABLE_PERCENT);
    expect(createProperties.oToCOrgRatio).toEqual({ minimum: 0, maximum: RATIO_INPUT_MAX, anyOf: [{ type: "number" }, { type: "null" }] });
    expect(createProperties.r0MeasurementCount).toEqual({ anyOf: [{ type: "integer", minimum: 0, maximum: 2_147_483_647 }, { type: "null" }] });
  });

  it("says the carbon figures are dry basis and the reconciliation checks excess only", () => {
    const described = toOperationJsonSchema(recordLabSampleInput).properties as Record<string, JsonSchema>;
    for (const field of ["totalCarbonPercent", "organicCarbonPercent", "inorganicCarbonPercent"]) {
      expect(described[field].description).toContain("dry basis");
    }
    expect(described.organicCarbonPercent.description).toContain("a shortfall is not checked");
    expect(described.oToCOrgRatio.description).toContain("Stored only when totalOxygenPercent is absent");
  });
});
