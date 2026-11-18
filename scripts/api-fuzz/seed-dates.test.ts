import { describe, expect, it } from "vitest";
import { formatFacilityDate } from "@/lib/date-utils";
import { MS_PER_HOUR, OUTPUT_RUN_START_HOURS_AGO, SEEDED_RUN_START_HOURS_AGO, seedIntakeDate } from "./seed-dates";

const FACILITY_TIME_ZONE = "UTC";
const CLOCK_CASES = [
  { clock: "2026-11-10T00:30:00.000Z", intakeDay: "2026-11-08", runDay: "2026-11-09" },
  { clock: "2026-11-10T12:30:00.000Z", intakeDay: "2026-11-09", runDay: "2026-11-10" },
  { clock: "2026-01-01T00:30:00.000Z", intakeDay: "2025-12-30", runDay: "2025-12-31" },
];

describe("seedIntakeDate", () => {
  it.each(CLOCK_CASES)("dates intakes strictly before the earliest run day at $clock", ({ clock, intakeDay, runDay }) => {
    const now = Date.parse(clock);
    const earliestRunStart = new Date(now - Math.max(SEEDED_RUN_START_HOURS_AGO, OUTPUT_RUN_START_HOURS_AGO) * MS_PER_HOUR);
    const earliestRunDay = formatFacilityDate(earliestRunStart, FACILITY_TIME_ZONE);
    const deliveryDate = seedIntakeDate(now, FACILITY_TIME_ZONE);

    expect(earliestRunDay).toBe(runDay);
    expect(deliveryDate < earliestRunDay).toBe(true);
    expect(deliveryDate).toBe(intakeDay);
  });
});
