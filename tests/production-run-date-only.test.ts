import { afterEach, describe, expect, it } from "vitest";
import { formatLocalDate } from "@/lib/date-utils";
import {
  createProductionRunSchema,
  updateProductionRunSchema,
} from "@/schemas/production-runs";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const REACTOR_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCTION_RUN_ID = "33333333-3333-4333-8333-333333333333";
const RUN_DATE = "2026-06-13";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("production run date-only handling", () => {
  it("stores the selected calendar day in a timezone ahead of UTC", () => {
    process.env.TZ = "Europe/Zurich";

    const parsed = createProductionRunSchema.parse({
      facilityId: FACILITY_ID,
      date: RUN_DATE,
      reactorId: REACTOR_ID,
      status: "draft",
      startTime: "10:00",
    });

    expect(parsed.date).toBeInstanceOf(Date);
    expect(formatLocalDate(parsed.date as Date)).toBe(RUN_DATE);
    expect((parsed.date as Date).toISOString().slice(0, 10)).toBe("2026-06-12");
  });

  it("does not parse update date-only strings as UTC midnight behind UTC", () => {
    process.env.TZ = "America/Los_Angeles";

    const parsed = updateProductionRunSchema.parse({
      productionRunId: PRODUCTION_RUN_ID,
      date: RUN_DATE,
    });

    expect(parsed.date).toBeInstanceOf(Date);
    expect(formatLocalDate(parsed.date as Date)).toBe(RUN_DATE);
    expect(formatLocalDate(new Date(RUN_DATE))).toBe("2026-06-12");
  });
});
