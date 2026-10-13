import { describe, expect, it } from "vitest";
import { formatFacilityDate, formatTimezoneLabel } from "@/lib/date-utils";
import {
  countryCodeFromText,
  findTimezoneEntry,
  isValidIanaTimezone,
  orderWithSuggestions,
  searchQueryAfterInputChange,
  searchTimezones,
  TIMEZONE_ENTRIES,
  timezonesForCountry,
} from "@/lib/timezones";
import { organizationSettingsFormSchema } from "@/schemas/organization-settings";
import {
  ianaTimezoneSchema,
  optionalTimezoneSchema,
  requiredTimezoneSchema,
} from "@/schemas/timezone";

const ids = (query: string) => searchTimezones(query).map((entry) => entry.id);

describe("isValidIanaTimezone", () => {
  it("accepts zones from the full list, including ones the old 28 omitted", () => {
    for (const zone of ["Africa/Dar_es_Salaam", "Asia/Kathmandu", "Pacific/Chatham", "UTC"]) {
      expect(isValidIanaTimezone(zone)).toBe(true);
    }
  });

  it("accepts aliases that tzdb folds into another entry", () => {
    for (const zone of ["Australia/Melbourne", "Asia/Calcutta", "Etc/UTC"]) {
      expect(isValidIanaTimezone(zone)).toBe(true);
    }
    expect(findTimezoneEntry("Australia/Melbourne")?.id).toBe("Australia/Sydney");
    expect(findTimezoneEntry("Asia/Calcutta")?.id).toBe("Asia/Kolkata");
    expect(ianaTimezoneSchema().parse("Australia/Melbourne")).toBe("Australia/Melbourne");
  });

  it("rejects unknown, mis-cased, empty and non-string values", () => {
    for (const value of ["Mars/Olympus", "africa/nairobi", "", " UTC", null, undefined, 3]) {
      expect(isValidIanaTimezone(value)).toBe(false);
    }
  });

  it("formats every accepted alias, since aliases can be stored", () => {
    for (const entry of TIMEZONE_ENTRIES) {
      for (const alias of entry.aliases) {
        expect(isValidIanaTimezone(alias)).toBe(true);
        expect(() => formatTimezoneLabel(alias)).not.toThrow();
        expect(() => formatFacilityDate(new Date(0), alias)).not.toThrow();
      }
    }
  });

  it("only lists zones the runtime can format", () => {
    for (const entry of TIMEZONE_ENTRIES) {
      expect(() => formatTimezoneLabel(entry.id)).not.toThrow();
    }
  });
});

describe("timezone schemas", () => {
  it("names the field when a required zone is missing or empty", () => {
    expect(requiredTimezoneSchema().safeParse("").error?.issues[0]?.message).toBe(
      "Timezone is required",
    );
    expect(requiredTimezoneSchema().safeParse(undefined).success).toBe(false);
  });

  it("rejects a zone that is not on the list", () => {
    const result = ianaTimezoneSchema().safeParse("Mars/Olympus");
    expect(result.error?.issues[0]?.message).toBe("Choose a timezone from the list.");
  });

  it("turns an empty optional zone into null", () => {
    expect(optionalTimezoneSchema().parse("")).toBeNull();
    expect(optionalTimezoneSchema().parse(null)).toBeNull();
    expect(optionalTimezoneSchema().parse("Africa/Nairobi")).toBe("Africa/Nairobi");
    expect(optionalTimezoneSchema().safeParse("nope").success).toBe(false);
  });
});

describe("organization defaults without a timezone", () => {
  it("saves with an empty timezone", () => {
    const base = {
      defaultCountry: "",
      defaultEvidenceMethod: "location",
      defaultPackaging: "loose",
    };
    for (const defaultTimezone of ["", null, undefined]) {
      const result = organizationSettingsFormSchema.safeParse({ ...base, defaultTimezone });
      expect(result.success).toBe(true);
      expect(result.data?.defaultTimezone).toBeNull();
    }
  });
});

describe("searchTimezones", () => {
  it("finds a zone by country", () => {
    expect(ids("Tanzania")).toEqual(["Africa/Dar_es_Salaam"]);
  });

  it("finds a zone by city, prefix and accent-insensitive", () => {
    expect(ids("Dar")[0]).toBe("Africa/Dar_es_Salaam");
    expect(ids("sao paulo")).toContain("America/Sao_Paulo");
    expect(ids("São Paulo")).toContain("America/Sao_Paulo");
  });

  it("finds a zone by IANA id and by readable name", () => {
    expect(ids("Africa/Dar_es_Salaam")[0]).toBe("Africa/Dar_es_Salaam");
    expect(ids("East Africa Time")).toContain("Africa/Nairobi");
  });

  it("does not match every zone for UTC", () => {
    const result = ids("UTC");
    expect(result).toEqual(["UTC"]);
    expect(result.length).toBeLessThan(TIMEZONE_ENTRIES.length / 10);
  });

  it("requires every word to match", () => {
    expect(ids("Tanzania Kenya")).toEqual([]);
    expect(ids("united states new york")).toContain("America/New_York");
  });

  it("returns everything for an empty query", () => {
    expect(searchTimezones("  ")).toHaveLength(TIMEZONE_ENTRIES.length);
  });

  it("ranks equal matches with preferred zones first", () => {
    const first = new Set(["America/Denver"]);
    expect(searchTimezones("United States", first)[0]?.id).toBe("America/Denver");
  });
});

describe("searchQueryAfterInputChange", () => {
  it("filters only on what the user types", () => {
    expect(searchQueryAfterInputChange("UT", "input-change")).toBe("UT");
    expect(searchQueryAfterInputChange(" UTC ", "input-change")).toBe("UTC");
  });

  it("ignores automatic fills, so typing the selected label still searches", () => {
    for (const reason of ["item-press", "focus-out", "input-clear", "none"]) {
      expect(searchQueryAfterInputChange("UTC", reason)).toBe("");
    }
    // UTC selected, user types "UTC": a search, narrowed to the UTC zone.
    const query = searchQueryAfterInputChange("UTC", "input-change");
    expect(searchTimezones(query).map((entry) => entry.id)).toEqual(["UTC"]);
  });
});

describe("country suggestions", () => {
  it("maps free-text country input to a code", () => {
    expect(countryCodeFromText("Tanzania")).toBe("TZ");
    expect(countryCodeFromText("  tanzania ")).toBe("TZ");
    expect(countryCodeFromText("TZ")).toBe("TZ");
    expect(countryCodeFromText("Ivory Coast")).toBe("CI");
    expect(countryCodeFromText("Côte d'Ivoire")).toBe("CI");
    expect(countryCodeFromText("Atlantis")).toBeNull();
    expect(countryCodeFromText("")).toBeNull();
  });

  it("gives a single-zone country exactly one suggestion", () => {
    expect(timezonesForCountry("Tanzania").map((entry) => entry.id)).toEqual([
      "Africa/Dar_es_Salaam",
    ]);
  });

  it("gives a multi-zone country all its zones, and none for an unknown one", () => {
    expect(timezonesForCountry("United States").length).toBeGreaterThan(3);
    expect(timezonesForCountry("Atlantis")).toEqual([]);
  });

  it("puts suggestions before the rest of the list", () => {
    const ordered = orderWithSuggestions(timezonesForCountry("Kenya"));
    expect(ordered[0]?.id).toBe("Africa/Nairobi");
    expect(ordered).toHaveLength(TIMEZONE_ENTRIES.length);
  });
});
