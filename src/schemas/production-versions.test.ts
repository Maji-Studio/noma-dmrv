import { describe, expect, it } from "vitest";
import { deleteProductionRunSchema, updateProductionRunSchema } from "./production-runs";
import { deleteProductionIncidentSchema, updateProductionIncidentSchema } from "./production-incidents";
import { deleteProductionSampleSchema, updateProductionSampleSchema } from "./production-samples";
import { deleteBiocharProductSchema, updateBiocharProductSchema } from "./biochar-products";

const ID = "33333333-3333-4333-8333-333333333333";
const VERSION = 1;
const commands = [
  [updateProductionRunSchema, { productionRunId: ID }],
  [deleteProductionRunSchema, { productionRunId: ID }],
  [updateProductionIncidentSchema, { productionIncidentId: ID, productionRunId: ID, incidentTime: new Date("2026-09-01T12:00:00Z"), description: "Incident", severity: "low" }],
  [deleteProductionIncidentSchema, { productionIncidentId: ID }],
  [updateProductionSampleSchema, { productionSampleId: ID, productionRunId: ID, timestamp: "2026-09-01T12:00:00Z" }],
  [deleteProductionSampleSchema, { productionSampleId: ID }],
  [updateBiocharProductSchema, { productId: ID }],
  [deleteBiocharProductSchema, { productId: ID }],
] as const;

describe.each(commands)("production version contract", (schema, input) => {
  it("accepts the loaded integer version", () => {
    expect(schema.parse({ ...input, expectedVersion: VERSION }).expectedVersion).toBe(VERSION);
  });
  it.each([undefined, null, 0, -1, 1.5, "1"])("requires a positive integer, rejecting %s", expectedVersion => {
    const result = schema.safeParse({ ...input, expectedVersion });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["expectedVersion"], message: "Reload this record before saving." }));
  });
});
