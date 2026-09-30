import { describe, expect, it } from "vitest";
import {
  loadGhgStatementReportsSchema,
  loadTelemetrySubmissionStateSchema,
  submitTelemetrySchema,
} from "./certification";

const REMOVAL_ID = "11111111-1111-4111-8111-111111111111";
const STATEMENT_ID = "22222222-2222-4222-8222-222222222222";

describe("certification action input schemas", () => {
  it("accepts a telemetry submission for a Removal id", () => {
    expect(
      submitTelemetrySchema.parse({
        removalId: REMOVAL_ID,
        confirmProduction: true,
      }),
    ).toEqual({ removalId: REMOVAL_ID, confirmProduction: true });
  });

  it("strips fields the telemetry action does not own", () => {
    expect(
      submitTelemetrySchema.parse({
        removalId: REMOVAL_ID,
        organizationId: "org-forged",
      }),
    ).toEqual({ removalId: REMOVAL_ID });
  });

  it.each([
    ["submitTelemetrySchema", submitTelemetrySchema, { removalId: "not-a-uuid" }],
    [
      "loadTelemetrySubmissionStateSchema",
      loadTelemetrySubmissionStateSchema,
      { removalId: 42 },
    ],
    [
      "loadGhgStatementReportsSchema",
      loadGhgStatementReportsSchema,
      { ghgStatementId: "" },
    ],
  ])("%s rejects a malformed id", (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("accepts well-formed read ids", () => {
    expect(
      loadTelemetrySubmissionStateSchema.safeParse({ removalId: REMOVAL_ID })
        .success,
    ).toBe(true);
    expect(
      loadGhgStatementReportsSchema.safeParse({ ghgStatementId: STATEMENT_ID })
        .success,
    ).toBe(true);
  });
});
