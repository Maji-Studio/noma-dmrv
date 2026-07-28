import { afterEach, describe, expect, it } from "vitest";
import {
  buildProductionRunWindow,
  productionRunTimezoneHelperText,
  productionRunTimingDefaults,
  resolveProductionRunTimingZoneSync,
  shouldResetProductionRunTimingDefaults,
} from "./production-run-timing";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

const FACILITIES = [
  { id: "facility-a", timezone: "Africa/Dar_es_Salaam" }, // UTC+3
  { id: "facility-b", timezone: "America/New_York" },
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

  it("does not roll a facility default through the process timezone's DST gap", () => {
    process.env.TZ = "Europe/Zurich";

    const defaults = productionRunTimingDefaults(
      {
        // 02:30 in Dar es Salaam, which is a nonexistent wall clock in Zurich
        // on this date. The process timezone must not roll it to 03:30.
        startTime: new Date("2026-03-28T23:30:00.000Z"),
        endTime: new Date("2026-03-29T00:30:00.000Z"),
      },
      "Africa/Dar_es_Salaam",
    );

    expect(defaults).toEqual({
      startDate: "2026-03-29",
      startTime: "02:30",
      endDate: "2026-03-29",
      endTime: "03:30",
    });
  });
});

describe("shouldResetProductionRunTimingDefaults", () => {
  it("resets untouched defaults when async facility resolution changes the zone", () => {
    expect(
      shouldResetProductionRunTimingDefaults("UTC", "Africa/Dar_es_Salaam", {}),
    ).toBe(true);
  });

  it.each(["startDate", "startTime", "endDate", "endTime"] as const)(
    "preserves operator edits when %s is dirty",
    (field) => {
      expect(
        shouldResetProductionRunTimingDefaults(
          "UTC",
          "Africa/Dar_es_Salaam",
          { [field]: true },
        ),
      ).toBe(false);
    },
  );

  it("does not reset when a facility change keeps the same zone", () => {
    expect(
      shouldResetProductionRunTimingDefaults(
        "Africa/Dar_es_Salaam",
        "Africa/Dar_es_Salaam",
        {},
      ),
    ).toBe(false);
  });

  it("keeps a dirty zone transition pending until edits are reverted", () => {
    const blocked = resolveProductionRunTimingZoneSync(
      "UTC",
      "Africa/Dar_es_Salaam",
      { startTime: true },
    );
    expect(blocked).toEqual({
      shouldReset: false,
      trackedTimeZone: "UTC",
    });

    expect(
      resolveProductionRunTimingZoneSync(
        blocked.trackedTimeZone,
        "Africa/Dar_es_Salaam",
        {},
      ),
    ).toEqual({
      shouldReset: true,
      trackedTimeZone: "Africa/Dar_es_Salaam",
    });
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
    startTimeStr: "00:30",
    endDateStr: "2026-11-01",
    endTimeStr: "03:00",
    includeEndTime: true,
    clearEndTime: false,
    timeZone: NEW_YORK,
  };

  it("reports an ambiguous fall-back start on the start field", () => {
    process.env.TZ = "Europe/Zurich";
    const result = buildProductionRunWindow({
      ...base,
      startTimeStr: "01:30",
    });

    expect(result).toEqual({
      ok: false,
      field: "startTime",
      message: expect.stringContaining(
        "01:30 occurs twice on 2026-11-01 in America/New York",
      ),
    });
  });

  it("reports an ambiguous fall-back end on the end field", () => {
    const result = buildProductionRunWindow({
      ...base,
      startTimeStr: "00:30",
      endTimeStr: "01:30",
    });

    expect(result).toEqual({
      ok: false,
      field: "endTime",
      message: expect.stringContaining(
        "01:30 occurs twice on 2026-11-01 in America/New York",
      ),
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
      "Facility time: Africa/Dar es Salaam",
    );
  });

  it("states the UTC fallback instead of applying it silently", () => {
    expect(productionRunTimezoneHelperText(FACILITIES, "facility-z")).toBe(
      "Facility time is not set. Using UTC.",
    );
  });

  it("does not claim one numeric offset for DST-transition windows", () => {
    expect(productionRunTimezoneHelperText(FACILITIES, "facility-b")).toBe(
      "Facility time: America/New York",
    );
  });
});
