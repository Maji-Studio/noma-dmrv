import { describe, expect, it } from "vitest";
import {
  certificationRemovalsHref,
  certificationSettingsHref,
} from "./links";

describe("certificationSettingsHref", () => {
  it("defaults to the connection tab", () => {
    const href = certificationSettingsHref("fac-abc123");
    expect(href).toBe(
      "/certification/settings?tab=connection&facility=fac-abc123",
    );
  });

  it("accepts a custom tab override", () => {
    const href = certificationSettingsHref("fac-abc123", "emissions");
    expect(href).toBe(
      "/certification/settings?tab=emissions&facility=fac-abc123",
    );
  });

  it("URL-encodes the facilityId in the facility query param", () => {
    const href = certificationSettingsHref("fac abc/123");
    expect(href).toContain("facility=fac%20abc%2F123");
  });

  it("URL-encodes the tab name when it contains special characters", () => {
    const href = certificationSettingsHref("fac-1", "my tab");
    expect(href).toContain("tab=my%20tab");
  });

  it("always starts with /certification/settings", () => {
    const href = certificationSettingsHref("any-facility");
    expect(href.startsWith("/certification/settings")).toBe(true);
  });

  it("produces a path that includes both tab and facility params", () => {
    const href = certificationSettingsHref("fac-xyz");
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get("tab")).toBe("connection");
    expect(url.searchParams.get("facility")).toBe("fac-xyz");
  });

  it("connection tab is the default so skipped checks always land in the right place", () => {
    // The 'skipped' transport check in CreditBatchHealthStrip links to
    // certificationSettingsHref(facilityId) without a tab override — it must
    // land on the connection tab, not an arbitrary default.
    const href = certificationSettingsHref("facility-id");
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get("tab")).toBe("connection");
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
