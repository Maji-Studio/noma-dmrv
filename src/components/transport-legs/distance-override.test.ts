import { describe, expect, it } from "vitest";
import {
  distanceOverridePatch,
  distanceProvenance,
  distanceReadFields,
  hasSavedOverride,
  OVERRIDE_DISTANCE_POSITIVE_MESSAGE,
  OVERRIDE_DISTANCE_REQUIRED_MESSAGE,
  overrideDistanceError,
  overrideSourceOptions,
  type DistanceOverrideDraft,
} from "./distance-override";

const derived: DistanceOverrideDraft = { overriding: false, distanceKm: null, source: null, note: "" };
const saved = { distanceKm: 60, source: "document" as const, note: "Detour" };

describe("distanceOverridePatch", () => {
  it("omits every distance key on a derived create", () => {
    expect(distanceOverridePatch(null, derived)).toEqual({});
  });

  it("omits every distance key on an unchanged derived edit", () => {
    expect(distanceOverridePatch({ distanceKm: null, source: null, note: null }, derived)).toEqual({});
  });

  it("sets an override with its source and note", () => {
    expect(distanceOverridePatch(null, { overriding: true, distanceKm: 55, source: "manual", note: " Bridge closed " }))
      .toEqual({ distanceKm: 55, source: "manual", note: "Bridge closed" });
  });

  it("defaults an override's source to manual entry", () => {
    expect(distanceOverridePatch(null, { overriding: true, distanceKm: 55, source: null, note: "" }))
      .toEqual({ distanceKm: 55, source: "manual" });
  });

  it("clears an override with null and lets the server clear its source", () => {
    expect(distanceOverridePatch(saved, derived)).toEqual({ distanceKm: null, note: null });
  });

  it("clears a legacy zero override on the next save", () => {
    expect(distanceOverridePatch({ distanceKm: 0, source: "manual", note: "Old" }, derived)).toEqual({ distanceKm: null, note: null });
  });

  it("omits an unchanged override so it is preserved", () => {
    expect(distanceOverridePatch(saved, { overriding: true, distanceKm: 60, source: "document", note: "Detour" })).toEqual({});
  });

  it("sends only the note when the note alone changes", () => {
    expect(distanceOverridePatch(saved, { overriding: true, distanceKm: 60, source: "document", note: "" })).toEqual({ note: null });
  });

  it("sends distance and source together when either changes", () => {
    expect(distanceOverridePatch(saved, { overriding: true, distanceKm: 60, source: "manual", note: "Detour" }))
      .toEqual({ distanceKm: 60, source: "manual" });
    expect(distanceOverridePatch(saved, { overriding: true, distanceKm: 70, source: "document", note: "Detour" }))
      .toEqual({ distanceKm: 70, source: "document" });
  });
});

describe("distanceOverridePatch after a route change", () => {
  const route = { routeChanged: true };

  it("sends a re-entered override in full even when it matches the old route's", () => {
    expect(distanceOverridePatch(saved, { overriding: true, distanceKm: 60, source: "document", note: "Detour" }, route))
      .toEqual({ distanceKm: 60, source: "document", note: "Detour" });
  });

  it("clears the note with a new override that has none", () => {
    expect(distanceOverridePatch(saved, { overriding: true, distanceKm: 60, source: "manual", note: "" }, route))
      .toEqual({ distanceKm: 60, source: "manual", note: null });
  });

  it("clears the old route's override and note when the new route is derived", () => {
    expect(distanceOverridePatch(saved, derived, route)).toEqual({ distanceKm: null, note: null });
    expect(distanceOverridePatch({ distanceKm: null, source: null, note: "Stale" }, derived, route)).toEqual({ distanceKm: null, note: null });
  });

  it("omits everything when neither route had an override", () => {
    expect(distanceOverridePatch({ distanceKm: null, source: null, note: null }, derived, route)).toEqual({});
  });
});

describe("overrideDistanceError", () => {
  it("accepts any derived draft and a positive override", () => {
    expect(overrideDistanceError(derived)).toBeNull();
    expect(overrideDistanceError({ ...derived, overriding: true, distanceKm: 1 })).toBeNull();
  });

  it("asks for a distance when the override is empty", () => {
    expect(overrideDistanceError({ ...derived, overriding: true, distanceKm: null })).toBe(OVERRIDE_DISTANCE_REQUIRED_MESSAGE);
    expect(overrideDistanceError({ ...derived, overriding: true, distanceKm: Number.NaN })).toBe(OVERRIDE_DISTANCE_REQUIRED_MESSAGE);
  });

  it("refuses zero and negative overrides", () => {
    expect(overrideDistanceError({ ...derived, overriding: true, distanceKm: 0 })).toBe(OVERRIDE_DISTANCE_POSITIVE_MESSAGE);
    expect(overrideDistanceError({ ...derived, overriding: true, distanceKm: -3 })).toBe(OVERRIDE_DISTANCE_POSITIVE_MESSAGE);
  });
});

describe("hasSavedOverride", () => {
  it("counts only a positive saved distance", () => {
    expect(hasSavedOverride(null)).toBe(false);
    expect(hasSavedOverride({ distanceKm: 0, source: "manual", note: null })).toBe(false);
    expect(hasSavedOverride(saved)).toBe(true);
  });
});

describe("overrideSourceOptions", () => {
  it("offers manual entry and a transport document", () => {
    expect(overrideSourceOptions("manual").map(option => option.value)).toEqual(["manual", "document"]);
  });

  it("keeps a legacy route calculation selectable in place", () => {
    expect(overrideSourceOptions("map_estimate").map(option => option.label)).toEqual(["Manual entry", "Transport document", "Route calculation"]);
  });
});

describe("distanceProvenance", () => {
  it("names the location and source of a derived distance", () => {
    expect(distanceProvenance({ overriding: false, locationName: "Kilolo depot", source: "manual", locationDefaultKm: 42 }))
      .toBe("From Kilolo depot. Source: Manual entry.");
    expect(distanceProvenance({ overriding: false, locationName: null, source: null, locationDefaultKm: 42 }))
      .toBe("From the location default.");
  });

  it("names what resetting an override returns to", () => {
    expect(distanceProvenance({ overriding: true, locationName: "Kilolo depot", source: "manual", locationDefaultKm: 42 }))
      .toBe("Override. Location default is 42 km.");
    expect(distanceProvenance({ overriding: true, locationName: null, source: null, locationDefaultKm: null }))
      .toBe("Override. The location has no distance for this facility.");
  });
});

describe("distanceReadFields", () => {
  it("reads a derived distance with its provenance behind the ⓘ", () => {
    expect(distanceReadFields({ overrideKm: null, effectiveKm: 42, note: "Old note", locationName: "Dar farm", derivedSource: "map_estimate" })).toEqual([
      expect.objectContaining({ label: "One-way distance", value: "42 km", hint: "From Dar farm. Source: Route calculation." }),
    ]);
  });

  it("reads an override with its note and the location default it replaces", () => {
    const fields = distanceReadFields({ overrideKm: 60, effectiveKm: 60, note: "Detour", locationDefaultKm: 42 });
    expect(fields).toEqual([
      expect.objectContaining({ value: "60 km", hint: "Override. Location default is 42 km." }),
      { label: "Distance note", value: "Detour" },
    ]);
    expect(fields[0]).not.toHaveProperty("secondary");
  });

  it("leaves a missing distance to the shared empty token", () => {
    expect(distanceReadFields({ overrideKm: null, effectiveKm: null, note: null })[0]?.value).toBeNull();
  });
});
