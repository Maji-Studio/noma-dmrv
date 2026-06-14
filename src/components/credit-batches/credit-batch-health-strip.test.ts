import { describe, expect, it } from "vitest";
import type { BatchHealthCheck } from "@/lib/certification/batch-health";
import {
  batchHealthFixLinkFor,
  compactBatchHealthDetail,
  fallbackBatchHealthFixTarget,
  NEXT_ACTION_DETAIL_MAX_CHARS,
  skippedBatchHealthFixLink,
} from "@/lib/certification/batch-health-links";

describe("compactBatchHealthDetail", () => {
  it("returns the string unchanged when it is shorter than the limit", () => {
    expect(compactBatchHealthDetail("Short detail.", 180)).toBe(
      "Short detail.",
    );
  });

  it("returns the string unchanged when its length equals the limit exactly", () => {
    const exactly180 = "x".repeat(180);
    expect(compactBatchHealthDetail(exactly180, 180)).toBe(exactly180);
    expect(compactBatchHealthDetail(exactly180, 180).length).toBe(180);
  });

  it("truncates and appends an ellipsis when the detail exceeds the limit", () => {
    const long = "a".repeat(200);
    const result = compactBatchHealthDetail(long, 180);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBe(181);
  });

  it("trims trailing whitespace from the slice before appending the ellipsis", () => {
    // Build a string where the 180-char boundary lands on a space.
    const core = "word ".repeat(36); // 36 × 5 = 180 chars; ends on a space
    expect(core.length).toBe(180);
    const long = core + "trailing";
    const result = compactBatchHealthDetail(long, 180);
    expect(result).toBe("word ".repeat(36).trimEnd() + "…");
    expect(result.endsWith(" …")).toBe(false);
  });

  it("uses NEXT_ACTION_DETAIL_MAX_CHARS as the default production limit", () => {
    expect(NEXT_ACTION_DETAIL_MAX_CHARS).toBe(180);
    const boundary = "a".repeat(180);
    expect(compactBatchHealthDetail(boundary)).toBe(boundary);
    expect(compactBatchHealthDetail("a".repeat(181))).toMatch(/^a{180}…$/);
  });

  it("handles an empty string without throwing", () => {
    expect(compactBatchHealthDetail("", 180)).toBe("");
    expect(compactBatchHealthDetail("", 0)).toBe("");
  });

  it("returns just the ellipsis when maxChars is 0 and detail is non-empty", () => {
    expect(compactBatchHealthDetail("hello", 0)).toBe("…");
  });

  it("does not add an ellipsis to a string that fits exactly in a small limit", () => {
    expect(compactBatchHealthDetail("abc", 3)).toBe("abc");
  });
});

describe("fallbackBatchHealthFixTarget", () => {
  it("routes carbon check failures to batchDetails", () => {
    expect(fallbackBatchHealthFixTarget("carbon")).toBe("batchDetails");
  });

  it("routes production check failures to productionRuns", () => {
    expect(fallbackBatchHealthFixTarget("production")).toBe("productionRuns");
  });

  it("routes transport check failures to deliveryDistances", () => {
    expect(fallbackBatchHealthFixTarget("transport")).toBe("deliveryDistances");
  });

  it("routes entityReadiness check failures to sourceData", () => {
    expect(fallbackBatchHealthFixTarget("entityReadiness")).toBe("sourceData");
  });
});

describe("batchHealthFixLinkFor", () => {
  const facilityId = "fac-001";

  it("routes a carbon check with no explicit fixTarget to #batch-details", () => {
    const check: BatchHealthCheck = {
      key: "carbon",
      label: "Carbon & durability inputs complete",
      status: "unmet",
    };
    const link = batchHealthFixLinkFor(check, facilityId);
    expect(link.label).toBe("Edit details");
    expect(link.href).toBe("#batch-details");
  });

  it("uses 'Link applications' label when production check falls back to batchDetails", () => {
    const check: BatchHealthCheck = {
      key: "production",
      label: "Production data linked",
      status: "unmet",
      fixTarget: "batchDetails",
    };
    const link = batchHealthFixLinkFor(check, facilityId);
    expect(link.label).toBe("Link applications");
    expect(link.href).toBe("#batch-details");
  });

  it("routes a production check with no fixTarget to productionRuns with the facility", () => {
    const check: BatchHealthCheck = {
      key: "production",
      label: "Production data linked",
      status: "unmet",
    };
    const link = batchHealthFixLinkFor(check, facilityId);
    expect(link.href).toBe(`/production-runs?facility=${facilityId}`);
  });

  it("routes a transport check to deliveries with the facility", () => {
    const check: BatchHealthCheck = {
      key: "transport",
      label: "Transport legs present",
      status: "unmet",
    };
    const link = batchHealthFixLinkFor(check, facilityId);
    expect(link.href).toBe(`/deliveries?facility=${facilityId}`);
  });

  it("routes entityReadiness to sourceData (production-runs) with the facility", () => {
    const check: BatchHealthCheck = {
      key: "entityReadiness",
      label: "Entity certifier fields complete",
      status: "unmet",
    };
    const link = batchHealthFixLinkFor(check, facilityId);
    expect(link.href).toContain("/production-runs");
    expect(link.href).toContain(facilityId);
  });

  it("routes an explicit biocharProducts fixTarget to biochar-products", () => {
    const check: BatchHealthCheck = {
      key: "production",
      label: "Production data linked",
      status: "unmet",
      fixTarget: "biocharProducts",
    };
    const link = batchHealthFixLinkFor(check, facilityId);
    expect(link.href).toBe(`/biochar-products?facility=${facilityId}`);
    expect(link.label).toBe("Link production run");
  });

  it("routes an explicit deliveries fixTarget to deliveries with the facility", () => {
    const check: BatchHealthCheck = {
      key: "transport",
      label: "Transport legs present",
      status: "unmet",
      fixTarget: "deliveries",
    };
    const link = batchHealthFixLinkFor(check, facilityId);
    expect(link.href).toBe(`/deliveries?facility=${facilityId}`);
  });

  it("prefers an explicit fixTarget over the fallback", () => {
    // carbon normally falls back to batchDetails, but an explicit override wins.
    const check: BatchHealthCheck = {
      key: "carbon",
      label: "Carbon & durability inputs complete",
      status: "unmet",
      fixTarget: "sourceData",
    };
    const link = batchHealthFixLinkFor(check, facilityId);
    expect(link.href).toContain("/production-runs");
  });

  it("routes skipped checks to certification connection settings", () => {
    expect(skippedBatchHealthFixLink(facilityId)).toEqual({
      label: "Finish facility setup",
      href: "/certification/settings?tab=connection&facility=fac-001",
    });
  });
});
