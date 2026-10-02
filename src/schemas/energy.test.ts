import { describe, expect, it } from "vitest";
import { energyBreakdownInputSchema } from "./energy";

const FACILITY_ID = "0987ce3e-7d5f-44dd-9ab9-089d5b1c7572";

describe("energyBreakdownInputSchema", () => {
  it("accepts a null start as all time", () => {
    expect(energyBreakdownInputSchema.parse({ facilityId: FACILITY_ID, from: null, to: "2026-09-30" })).toEqual({
      facilityId: FACILITY_ID,
      from: null,
      to: "2026-09-30",
    });
  });

  it("accepts a one-day period", () => {
    expect(
      energyBreakdownInputSchema.safeParse({ facilityId: FACILITY_ID, from: "2026-09-30", to: "2026-09-30" }).success,
    ).toBe(true);
  });

  it("refuses a start after the end, on the start field", () => {
    const result = energyBreakdownInputSchema.safeParse({
      facilityId: FACILITY_ID,
      from: "2026-10-01",
      to: "2026-09-30",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["from"]);
  });

  it("refuses a malformed date and a non-uuid facility", () => {
    expect(
      energyBreakdownInputSchema.safeParse({ facilityId: FACILITY_ID, from: null, to: "2026-9-30" }).success,
    ).toBe(false);
    expect(
      energyBreakdownInputSchema.safeParse({ facilityId: FACILITY_ID, from: "2026-02-30", to: "2026-09-30" }).success,
    ).toBe(false);
    expect(energyBreakdownInputSchema.safeParse({ facilityId: "facility", from: null, to: "2026-09-30" }).success).toBe(
      false,
    );
  });
});
