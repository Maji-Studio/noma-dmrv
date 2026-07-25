import { afterEach, describe, expect, it } from "vitest";
import {
  combineDateAndTime,
  DEFAULT_FACILITY_TIMEZONE,
  formatFacilityDate,
  formatFacilityTime,
  formatLocalDate,
  parseLocalDateString,
  resolveFacilityTimezone,
  toDateInputValue,
} from "@/lib/date-utils";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

// #46 — a calendar day must parse at LOCAL midnight; `new Date("YYYY-MM-DD")`
// parses at UTC midnight, shifting the stored date back one day for users west
// of UTC. `parseLocalDateString` is the shared helper behind that fix, and it is
// what stamps a biochar product's production date from its linked run's date.
describe("parseLocalDateString", () => {
  it("parses a calendar day at local midnight", () => {
    const date = parseLocalDateString("2026-01-18");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(18);
    expect(date.getHours()).toBe(0);
  });

  it("preserves the calendar day in a timezone ahead of UTC", () => {
    process.env.TZ = "Europe/Zurich";
    const date = parseLocalDateString("2026-06-13");
    expect(formatLocalDate(date)).toBe("2026-06-13");
    // The same instant is the previous day in UTC — the bug we must not regress.
    expect(date.toISOString().slice(0, 10)).toBe("2026-06-12");
  });

  it("preserves the calendar day in a timezone behind UTC", () => {
    process.env.TZ = "America/Los_Angeles";
    const date = parseLocalDateString("2026-06-13");
    expect(formatLocalDate(date)).toBe("2026-06-13");
  });

  it("rejects an invalid calendar day", () => {
    expect(() => parseLocalDateString("2026-02-30")).toThrow();
  });
});

// QA F-2 — a production run's start/end are a wall clock at a physical plant.
// `new Date("YYYY-MM-DDTHH:MM")` is the zoneless date-time form and is parsed in
// the BROWSER's zone, so a CEST (UTC+2) operator entering 08:00 for a UTC+3
// plant stored 06:00Z instead of 05:00Z. The telemetry importer clips CSV rows
// to the stored window, so the readings in the shifted hour were dropped with no
// error. These assertions are on absolute instants and must hold whatever the
// machine's zone is.
describe("combineDateAndTime", () => {
  const MACHINE_ZONES = ["Europe/Zurich", "America/New_York", "UTC"];
  const DAR_ES_SALAAM = "Africa/Dar_es_Salaam"; // UTC+3, no DST
  const LOS_ANGELES = "America/Los_Angeles"; // UTC-7 in July, UTC-8 in January

  it("resolves a facility wall clock ahead of UTC", () => {
    for (const machineZone of MACHINE_ZONES) {
      process.env.TZ = machineZone;
      expect(
        combineDateAndTime("2026-07-17", "08:00", DAR_ES_SALAAM).toISOString(),
      ).toBe("2026-07-17T05:00:00.000Z");
      expect(
        combineDateAndTime("2026-07-17", "16:00", DAR_ES_SALAAM).toISOString(),
      ).toBe("2026-07-17T13:00:00.000Z");
    }
  });

  it("resolves a facility wall clock behind UTC, respecting its DST", () => {
    for (const machineZone of MACHINE_ZONES) {
      process.env.TZ = machineZone;
      // July — PDT (UTC-7).
      expect(
        combineDateAndTime("2026-07-17", "08:00", LOS_ANGELES).toISOString(),
      ).toBe("2026-07-17T15:00:00.000Z");
      // January — PST (UTC-8).
      expect(
        combineDateAndTime("2026-01-15", "08:00", LOS_ANGELES).toISOString(),
      ).toBe("2026-01-15T16:00:00.000Z");
    }
  });

  it("crosses midnight in the facility zone for an overnight run", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(
      combineDateAndTime("2026-07-18", "02:30", DAR_ES_SALAAM).toISOString(),
    ).toBe("2026-07-17T23:30:00.000Z");
  });

  it("round-trips through the facility display helpers", () => {
    process.env.TZ = "America/Los_Angeles";
    for (const timezone of [DAR_ES_SALAAM, LOS_ANGELES, "Asia/Kolkata"]) {
      const instant = combineDateAndTime("2026-07-17", "08:00", timezone);
      expect(formatFacilityDate(instant, timezone)).toBe("2026-07-17");
      expect(formatFacilityTime(instant, timezone, "HH:mm")).toBe("08:00");
    }
  });
});

describe("resolveFacilityTimezone", () => {
  const facilities = [
    { id: "facility-a", timezone: "Africa/Dar_es_Salaam" },
    { id: "facility-b", timezone: "America/Los_Angeles" },
  ];

  it("resolves the selected facility's zone", () => {
    expect(resolveFacilityTimezone(facilities, "facility-b")).toBe(
      "America/Los_Angeles",
    );
  });

  // Edit mode for a run whose facility is not in the context list, and the
  // create form before the facility list has loaded. Falls back to the
  // `facilities.timezone` column default rather than the browser's zone.
  it("falls back to the column default for an unknown or absent facility", () => {
    expect(resolveFacilityTimezone(facilities, "facility-z")).toBe(
      DEFAULT_FACILITY_TIMEZONE,
    );
    expect(resolveFacilityTimezone(facilities, null)).toBe(
      DEFAULT_FACILITY_TIMEZONE,
    );
    expect(resolveFacilityTimezone([], "facility-a")).toBe(
      DEFAULT_FACILITY_TIMEZONE,
    );
  });
});

describe("toDateInputValue", () => {
  it("normalizes persisted Date values for native date inputs", () => {
    process.env.TZ = "Europe/Zurich";
    const persisted = new Date(2026, 6, 17, 14, 30);

    expect(toDateInputValue(persisted)).toBe("2026-07-17");
  });

  it("normalizes persisted ISO strings and preserves date-only strings", () => {
    process.env.TZ = "Europe/Zurich";

    expect(toDateInputValue("2026-07-17T12:00:00.000Z")).toBe(
      "2026-07-17",
    );
    expect(toDateInputValue("2026-07-17")).toBe("2026-07-17");
  });

  // #46 west-of-UTC regression: date-only values persist at UTC midnight. Reading
  // them on the browser calendar shifts the day back for users behind UTC, so a
  // status-only edit would save the wrong day. Both the ISO string and the Date
  // form of a UTC-midnight value must render the stored calendar day.
  it("keeps the UTC calendar day for persisted midnight values west of UTC", () => {
    process.env.TZ = "America/Los_Angeles";

    expect(toDateInputValue("2026-07-17T00:00:00.000Z")).toBe("2026-07-17");
    expect(toDateInputValue(new Date("2026-07-17T00:00:00.000Z"))).toBe(
      "2026-07-17",
    );
  });
});
