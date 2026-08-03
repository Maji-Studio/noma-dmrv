import { afterEach, describe, expect, it } from "vitest";
import {
  AmbiguousLocalTimeError,
  combineDateAndTime,
  DEFAULT_FACILITY_TIMEZONE,
  formatFacilityDate,
  formatFacilityTime,
  formatLocalDate,
  NonexistentLocalTimeError,
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

// A wall clock is not always exactly one instant. `fromZonedTime` answered both
// DST edges wrongly: the nonexistent New York 2026-03-08 02:30 became 06:30Z,
// which reads back as 01:30 — silently storing an hour the operator never
// entered, into the window that clips the telemetry CSV and sets the registry
// `measured_at` — and ambiguous times resolved to the earlier offset in New
// York but the later one in Zurich. All assertions here are on absolute
// instants and must hold whatever the machine's zone is.
describe("combineDateAndTime across DST transitions", () => {
  const MACHINE_ZONES = ["Europe/Zurich", "America/New_York", "UTC"];
  const NEW_YORK = "America/New_York"; // forward 2026-03-08, back 2026-11-01
  const ZURICH = "Europe/Zurich"; // forward 2026-03-29, back 2026-10-25

  it("rejects a wall clock inside the spring-forward gap", () => {
    for (const machineZone of MACHINE_ZONES) {
      process.env.TZ = machineZone;
      expect(() => combineDateAndTime("2026-03-08", "02:30", NEW_YORK)).toThrow(
        NonexistentLocalTimeError,
      );
      expect(() => combineDateAndTime("2026-03-29", "02:30", ZURICH)).toThrow(
        NonexistentLocalTimeError,
      );
    }
  });

  it("names the time, date and zone in the rejection", () => {
    process.env.TZ = "UTC";
    expect(() => combineDateAndTime("2026-03-08", "02:30", NEW_YORK)).toThrow(
      "02:30 does not exist on 2026-03-08 in America/New York. Clocks move" +
        " forward that day. Enter a time outside the skipped hour.",
    );
  });

  it("still accepts the wall clocks on either side of the gap", () => {
    process.env.TZ = "Europe/Zurich";
    // 01:30 EST (UTC-5) and 03:30 EDT (UTC-4) both exist on the same day.
    expect(
      combineDateAndTime("2026-03-08", "01:30", NEW_YORK).toISOString(),
    ).toBe("2026-03-08T06:30:00.000Z");
    expect(
      combineDateAndTime("2026-03-08", "03:30", NEW_YORK).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("rejects a wall clock inside the fall-back fold", () => {
    for (const machineZone of MACHINE_ZONES) {
      process.env.TZ = machineZone;
      expect(
        () => combineDateAndTime("2026-11-01", "01:30", NEW_YORK),
      ).toThrow(AmbiguousLocalTimeError);
      expect(
        () => combineDateAndTime("2026-10-25", "02:30", ZURICH),
      ).toThrow(AmbiguousLocalTimeError);
    }
  });

  it("names the repeated time, date and zone in the fold rejection", () => {
    process.env.TZ = "UTC";
    expect(() => combineDateAndTime("2026-11-01", "01:30", NEW_YORK)).toThrow(
      "01:30 occurs twice on 2026-11-01 in America/New York. Clocks move" +
        " back that day. Enter a time outside the repeated hour.",
    );
  });

  it("leaves a zone without DST untouched", () => {
    process.env.TZ = "America/New_York";
    // The control case: no transition, so there is nothing to disambiguate.
    expect(
      combineDateAndTime("2026-07-17", "08:00", "Africa/Dar_es_Salaam").toISOString(),
    ).toBe("2026-07-17T05:00:00.000Z");
    expect(
      combineDateAndTime("2026-03-08", "02:30", "Africa/Dar_es_Salaam").toISOString(),
    ).toBe("2026-03-07T23:30:00.000Z");
  });

  it("returns an Invalid Date for a malformed pair rather than throwing", () => {
    process.env.TZ = "UTC";
    expect(combineDateAndTime("", "", NEW_YORK).getTime()).toBeNaN();
    expect(combineDateAndTime("2026-13-45", "08:00", NEW_YORK).getTime()).toBeNaN();
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
