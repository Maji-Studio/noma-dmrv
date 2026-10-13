import { describe, expect, it } from "vitest";
import { createProductionRunInput, updateProductionRunInput } from "@/schemas/production-run-input";
import { resolveRunInstant } from "./production-run-times";
import { toOperationJsonSchema } from "./json-schema";
import { validationFailed } from "./errors";

const id = "00000000-0000-4000-8000-000000000001";
const base = { facilityId: id, reactorId: id };
describe("production run instant contract", () => {
  it.each([new Date("2026-01-01T10:00:00Z"), "2026-01-01T10:00:00Z", "2026-01-01T12:00:00+02:00", { date: "2026-01-01", time: "10:00" }])("accepts %j", (startTime) => {
    expect(createProductionRunInput.safeParse({ ...base, startTime }).success).toBe(true);
    expect(updateProductionRunInput.safeParse({ productionRunId: id, expectedVersion: 1, startTime, endTime: startTime }).success).toBe(true);
  });
  it.each(["startTime", "endTime"] as const)("refuses a missing offset on %s with actionable field guidance", (field) => {
    const parsed = createProductionRunInput.safeParse({ ...base, startTime: "2026-01-01T10:00:00Z", [field]: "2026-01-01T10:00:00" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(validationFailed(parsed.error)).toMatchObject({ code: "validation_failed", issues: [
      { path: [field], message: expect.stringContaining("offset") },
    ] });
  });
  it.each(["startTime", "endTime"] as const)("refuses DST gaps and folds on %s", (field) => {
    for (const date of ["2026-03-29", "2026-10-25"]) {
      expect(() => resolveRunInstant({ date, time: "02:30" }, "Europe/Paris", field)).toThrow(expect.objectContaining({
        code: "validation_failed", issues: [expect.objectContaining({ path: [field] })],
      }));
    }
  });
  it.each([["Europe/Paris", "2026-01-01T09:00:00.000Z"], ["Africa/Nairobi", "2026-01-01T07:00:00.000Z"]])("uses the facility zone %s", (zone, expected) => {
    expect(resolveRunInstant({ date: "2026-01-01", time: "10:00" }, zone, "startTime").toISOString()).toBe(expected);
  });
  it.each([createProductionRunInput, updateProductionRunInput])("publishes exactly the two wire shapes", (schema) => {
    const published = toOperationJsonSchema(schema);
    const text = JSON.stringify(published);
    for (const forbidden of ["feedstockWetMassKg", "startDate", "endDate", '"Date"']) expect(text).not.toContain(forbidden);
    const time = (published.properties as Record<string, { anyOf: unknown[] }>).startTime;
    expect(time.anyOf).toHaveLength(2);
    expect(time.anyOf).toEqual(expect.arrayContaining([expect.objectContaining({ type: "string", format: "date-time" }), expect.objectContaining({ type: "object", required: ["date", "time"] })]));
  });
  it("rejects legacy fields and malformed local dates", () => {
    expect(createProductionRunInput.safeParse({ ...base, startTime: new Date(), feedstockWetMassKg: 1 }).success).toBe(false);
    expect(createProductionRunInput.safeParse({ ...base, startTime: { date: "2026-02-30", time: "12:00" } }).success).toBe(false);
  });
});
