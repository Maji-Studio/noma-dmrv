import { describe, expect, it } from "vitest";
import {
  CERTIFICATION_SETTINGS_CERTIFIER_SECTION,
  CERTIFICATION_SETTINGS_EMISSIONS_SECTION,
  CERTIFICATION_SETTINGS_SECTION_PARAM,
  certificationEmissionEstimatesHref,
  certificationRemovalsHref,
  certificationSettingsHref,
} from "./links";

describe("certificationEmissionEstimatesHref", () => {
  it("selects the emissions section for the active facility", () => {
    expect(certificationEmissionEstimatesHref("fac abc/123")).toBe(
      `/certification/settings?${CERTIFICATION_SETTINGS_SECTION_PARAM}=${CERTIFICATION_SETTINGS_EMISSIONS_SECTION}` +
        `&facility=fac%20abc%2F123`,
    );
  });

  it("uses a query param, not a fragment — only the selected section mounts", () => {
    // The settings page is a rail plus one detail pane, so `#emission-estimates`
    // would scroll to an element that has not rendered.
    const href = certificationEmissionEstimatesHref("fac-1");
    expect(href).not.toContain("#");
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get(CERTIFICATION_SETTINGS_SECTION_PARAM)).toBe(
      CERTIFICATION_SETTINGS_EMISSIONS_SECTION,
    );
  });
});

describe("certificationSettingsHref", () => {
  it("defaults to the certifier section", () => {
    const href = certificationSettingsHref("fac-abc123");
    expect(href).toBe(
      "/certification/settings?section=certifier&facility=fac-abc123",
    );
  });

  it("accepts a section override", () => {
    const href = certificationSettingsHref("fac-abc123", "sources");
    expect(href).toBe(
      "/certification/settings?section=sources&facility=fac-abc123",
    );
  });

  it("URL-encodes the facilityId in the facility query param", () => {
    const href = certificationSettingsHref("fac abc/123");
    expect(href).toContain("facility=fac%20abc%2F123");
  });

  it("URL-encodes the section when it contains special characters", () => {
    const href = certificationSettingsHref("fac-1", "my section");
    expect(href).toContain("section=my%20section");
  });

  it("always starts with /certification/settings", () => {
    const href = certificationSettingsHref("any-facility");
    expect(href.startsWith("/certification/settings")).toBe(true);
  });

  it("produces a path that includes both section and facility params", () => {
    const href = certificationSettingsHref("fac-xyz");
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get(CERTIFICATION_SETTINGS_SECTION_PARAM)).toBe(
      CERTIFICATION_SETTINGS_CERTIFIER_SECTION,
    );
    expect(url.searchParams.get("facility")).toBe("fac-xyz");
  });

  it("certifier is the default so unmet setup checks land in the right place", () => {
    // The submission checks and the batch-selection step both link to
    // certificationSettingsHref(facilityId) with no override. Keys and the
    // project link are one pane now, so either kind of gap is fixed there.
    const href = certificationSettingsHref("facility-id");
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get(CERTIFICATION_SETTINGS_SECTION_PARAM)).toBe(
      CERTIFICATION_SETTINGS_CERTIFIER_SECTION,
    );
  });
});

describe("certificationRemovalsHref", () => {
  it("redirects to removals without a query when searchParams is empty", () => {
    expect(certificationRemovalsHref({})).toBe("/certification/removals");
  });

  it("preserves a single facility param", () => {
    expect(certificationRemovalsHref({ facility: "fac-abc123" })).toBe(
      "/certification/removals?facility=fac-abc123",
    );
  });

  it("preserves multiple distinct params", () => {
    const target = certificationRemovalsHref({
      facility: "fac-1",
      removal: "rem-2",
    });
    const url = new URL(target, "http://localhost");
    expect(url.searchParams.get("facility")).toBe("fac-1");
    expect(url.searchParams.get("removal")).toBe("rem-2");
  });

  it("appends all entries for array-valued params", () => {
    const target = certificationRemovalsHref({ tag: ["a", "b", "c"] });
    const url = new URL(target, "http://localhost");
    expect(url.searchParams.getAll("tag")).toEqual(["a", "b", "c"]);
  });

  it("filters out undefined-valued params", () => {
    const target = certificationRemovalsHref({
      facility: "fac-1",
      missing: undefined,
    });
    const url = new URL(target, "http://localhost");
    expect(url.searchParams.has("missing")).toBe(false);
    expect(url.searchParams.get("facility")).toBe("fac-1");
  });

  it("preserves empty-string params as empty query values", () => {
    const target = certificationRemovalsHref({
      facility: "fac-1",
      empty: "",
    });
    const url = new URL(target, "http://localhost");
    expect(url.searchParams.has("empty")).toBe(true);
    expect(url.searchParams.get("empty")).toBe("");
  });

  it("URL-encodes special characters in param values", () => {
    expect(certificationRemovalsHref({ facility: "my facility/1" })).toContain(
      "facility=my+facility%2F1",
    );
  });
});
