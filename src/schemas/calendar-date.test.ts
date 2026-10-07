import { describe, expect, it } from "vitest";
import { calendarDateSchema, parseCalendarDate } from "./helpers";
import { createFeedstockSchema, updateFeedstockSchema } from "./feedstocks";

const FEEDSTOCK_ID = "11111111-1111-4111-8111-111111111111";

describe("parseCalendarDate", () => {
  it.each([
    ["2026-10-06", "2026-10-06T00:00:00.000Z"],
    ["2024-02-29", "2024-02-29T00:00:00.000Z"],
    ["2026-12-31", "2026-12-31T00:00:00.000Z"],
  ])("decodes %s to UTC midnight", (value, iso) => {
    expect(parseCalendarDate(value)?.toISOString()).toBe(iso);
  });

  it.each([
    "2026-02-31",
    "2026-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-10-00",
    "2026-10-06T23:00:00-07:00",
    "2026-10-06T00:00:00Z",
    "2026-10-6",
    "06.10.2026",
    "",
  ])("refuses %j", (value) => {
    expect(parseCalendarDate(value)).toBeNull();
  });
});

describe("calendarDateSchema", () => {
  const schema = calendarDateSchema();

  it("round-trips a business date regardless of the server's time zone", () => {
    const decoded = schema.parse("2026-10-06");
    expect(decoded.toISOString().slice(0, 10)).toBe("2026-10-06");
    // The value the form decoded is accepted again by the server action.
    expect(schema.parse(decoded).getTime()).toBe(decoded.getTime());
  });

  it("decodes and re-validates the same UTC calendar day across time zones", () => {
    const originalTimezone = process.env.TZ;
    try {
      for (const timezone of ["America/Los_Angeles", "Asia/Tokyo"]) {
        process.env.TZ = timezone;
        const decoded = calendarDateSchema().parse("2026-10-06");
        expect(decoded.toISOString()).toBe("2026-10-06T00:00:00.000Z");
        expect(calendarDateSchema().parse(decoded).toISOString()).toBe("2026-10-06T00:00:00.000Z");
      }
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("refuses an instant that is not UTC midnight", () => {
    const result = schema.safeParse(new Date("2026-10-06T23:00:00-07:00"));
    expect(result.success).toBe(false);
  });

  it("names the field and says what to fix", () => {
    const result = createFeedstockSchema.safeParse({ deliveryDate: "2026-02-31" });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((candidate) => candidate.path.join(".") === "deliveryDate");
    expect(issue?.message).toBe("Enter a valid date.");
  });
});

describe("feedstock delivery dates", () => {
  it("does not shift a date entered with an offset into the next UTC day", () => {
    const result = updateFeedstockSchema.safeParse({
      feedstockId: FEEDSTOCK_ID,
      deliveryDate: "2026-10-06T23:00:00-07:00",
    });
    expect(result.success).toBe(false);
  });

  it("stores the calendar day it was given", () => {
    const parsed = updateFeedstockSchema.parse({
      feedstockId: FEEDSTOCK_ID,
      deliveryDate: "2026-10-06",
    });
    expect(parsed.deliveryDate?.toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });
});
