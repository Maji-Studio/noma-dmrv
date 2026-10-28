import { describe, expect, it } from "vitest";
import {
  certificationRemovalsHref,
  facilityCertificationSettingsHref,
  productionRunDeepLinkHref,
  registrySettingsHref,
  removalTemplatesSettingsHref,
  traceabilityActivityHref,
  traceabilityApplicationHref,
  traceabilityBatchHref,
} from "./links";

describe("settings link builders", () => {
  it("sends registry fixes to Settings, Registry with the working facility", () => {
    expect(registrySettingsHref("fac abc/123")).toBe("/settings/registry?facility=fac%20abc%2F123");
    expect(registrySettingsHref()).toBe("/settings/registry");
    expect(registrySettingsHref(null)).toBe("/settings/registry");
  });

  it("sends project link, tier and soil reference fixes to Settings, Facilities", () => {
    expect(facilityCertificationSettingsHref("fac-1")).toBe("/settings/facilities?facility=fac-1");
  });

  it("sends component fixes to Settings, Removal templates, optionally narrowed to one template", () => {
    expect(removalTemplatesSettingsHref("fac-1")).toBe("/settings/removal-templates?facility=fac-1");
    expect(removalTemplatesSettingsHref("fac-1", "rvt new")).toBe(
      "/settings/removal-templates?facility=fac-1&template=rvt%20new",
    );
  });

  it("never links to the retired certification settings route", () => {
    for (const href of [
      registrySettingsHref("f"),
      facilityCertificationSettingsHref("f"),
      removalTemplatesSettingsHref("f", "t"),
    ]) {
      expect(href.startsWith("/settings/")).toBe(true);
      expect(href).not.toContain("/certification/settings");
    }
  });
});

describe("certificationRemovalsHref", () => {
  it("links to removals without a query when searchParams is empty", () => {
    expect(certificationRemovalsHref({})).toBe("/removals");
  });

  it("preserves a single facility param", () => {
    expect(certificationRemovalsHref({ facility: "fac-abc123" })).toBe(
      "/removals?facility=fac-abc123",
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

describe("record deep links", () => {
  it("encodes production-run and traceability identities", () => {
    expect(productionRunDeepLinkHref("run/1", "facility 1")).toBe(
      "/production-runs?facility=facility+1&run=run%2F1",
    );
    expect(traceabilityApplicationHref("batch/1", "application 1")).toBe(
      "/traceability?batch=batch%2F1&application=application+1",
    );
    expect(traceabilityActivityHref("batch/1", "facility 1")).toBe(
      "/traceability?facility=facility+1&batch=batch%2F1&view=activity",
    );
    expect(traceabilityBatchHref("batch/1", "facility 1")).toBe(
      "/traceability?facility=facility+1&batch=batch%2F1",
    );
  });
});
