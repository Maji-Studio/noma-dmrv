import { afterEach, describe, expect, it } from "vitest";
import {
  productionRunTimezoneHelperText,
  productionRunTimingDefaults,
} from "./production-run-timing";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

const FACILITIES = [
  { id: "facility-a", timezone: "Africa/Dar_es_Salaam" }, // UTC+3
];

// QA F-2 read-back half. Fixing only the write side and reading the stored
// instant back on the browser calendar would re-shift the window on every edit.
describe("productionRunTimingDefaults", () => {
  it("reads a stored instant back on the facility clock, not the browser's", () => {
    process.env.TZ = "Europe/Berlin"; // CEST (UTC+2)

    const defaults = productionRunTimingDefaults(
      {
        startTime: new Date("2026-07-17T05:00:00.000Z"),
        endTime: new Date("2026-07-17T13:00:00.000Z"),
      },
      "Africa/Dar_es_Salaam",
    );

    expect(defaults).toEqual({
      startDate: "2026-07-17",
      startTime: "08:00",
      endDate: "2026-07-17",
      endTime: "16:00",
    });
  });

  it("leaves the end pair blank for an unfinished run", () => {
    const defaults = productionRunTimingDefaults(
      { startTime: new Date("2026-07-17T23:30:00.000Z") },
      "Africa/Dar_es_Salaam",
    );

    // Overnight: the facility calendar day is already the 18th.
    expect(defaults.startDate).toBe("2026-07-18");
    expect(defaults.startTime).toBe("02:30");
    expect(defaults.endDate).toBe("");
    expect(defaults.endTime).toBe("");
  });
});

describe("productionRunTimezoneHelperText", () => {
  it("names the resolved facility zone", () => {
    expect(productionRunTimezoneHelperText(FACILITIES, "facility-a")).toBe(
      "Facility time — Africa/Dar es Salaam (UTC+3)",
    );
  });

  it("states the UTC fallback instead of applying it silently", () => {
    expect(productionRunTimezoneHelperText(FACILITIES, "facility-z")).toBe(
      "Facility time unknown — using UTC (UTC+0)",
    );
  });
});
