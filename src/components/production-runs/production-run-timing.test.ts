import { afterEach, describe, expect, it } from "vitest";
import {
  buildProductionRunWindow,
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

// The submit path shares `combineDateAndTime` with the schema, so it inherits
// the same DST policy: a gap wall clock comes back as a field-targeted
// rejection the form can `setError` on, never a thrown error or a shifted
// instant written to the run window.
describe("buildProductionRunWindow", () => {
  const NEW_YORK = "America/New_York";
  const base = {
    startDateStr: "2026-11-01",
    startTimeStr: "01:30",
    endDateStr: "2026-11-01",
    endTimeStr: "03:00",
    includeEndTime: true,
    clearEndTime: false,
    timeZone: NEW_YORK,
  };

  it("resolves an ambiguous fall-back window to its earlier instants", () => {
    process.env.TZ = "Europe/Zurich";
    const result = buildProductionRunWindow(base);

    expect(result).toEqual({
      ok: true,
      startTime: new Date("2026-11-01T05:30:00.000Z"),
      endTime: new Date("2026-11-01T08:00:00.000Z"),
    });
  });

  it("reports a gap start on the start field instead of throwing", () => {
    process.env.TZ = "UTC";
    const result = buildProductionRunWindow({
      ...base,
      startDateStr: "2026-03-08",
      startTimeStr: "02:30",
      endDateStr: "2026-03-08",
      endTimeStr: "04:00",
    });

    expect(result).toEqual({
      ok: false,
      field: "startTime",
      message: expect.stringContaining("02:30 does not exist on 2026-03-08"),
    });
  });

  it("reports a gap end on the end field", () => {
    process.env.TZ = "UTC";
    const result = buildProductionRunWindow({
      ...base,
      startDateStr: "2026-03-08",
      startTimeStr: "01:30",
      endDateStr: "2026-03-08",
      endTimeStr: "02:30",
    });

    expect(result).toEqual({
      ok: false,
      field: "endTime",
      message: expect.stringContaining("02:30 does not exist on 2026-03-08"),
    });
  });

  it("keeps the three-way end meaning: clear, omit, write", () => {
    process.env.TZ = "UTC";
    const endOf = (overrides: Partial<typeof base>) => {
      const result = buildProductionRunWindow({ ...base, ...overrides });
      if (!result.ok) throw new Error(`expected an ok window: ${result.message}`);
      return result.endTime;
    };

    expect(endOf({ clearEndTime: true })).toBeNull();
    expect(endOf({ includeEndTime: false })).toBeUndefined();
    expect(endOf({ endTimeStr: "" })).toBeUndefined();
    expect(endOf({})).toEqual(new Date("2026-11-01T08:00:00.000Z"));
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
