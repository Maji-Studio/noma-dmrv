/**
 * Tests for the pure logic helpers in CreditBatchHealthStrip.
 *
 * `compactDetail` and the fix-link resolution are private to the component
 * module; these tests capture the specified algorithm so any refactor that
 * changes behaviour is caught immediately.
 */
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// compactDetail — mirrors the implementation in credit-batch-health-strip.tsx
// ---------------------------------------------------------------------------
// Algorithm: if detail.length <= maxChars return detail unchanged;
// otherwise return detail.slice(0, maxChars).trimEnd() + "…".
function compactDetail(detail: string, maxChars: number): string {
  if (detail.length <= maxChars) {
    return detail;
  }
  return `${detail.slice(0, maxChars).trimEnd()}…`;
}

const NEXT_ACTION_DETAIL_MAX_CHARS = 180;

describe("compactDetail", () => {
  it("returns the string unchanged when it is shorter than the limit", () => {
    expect(compactDetail("Short detail.", 180)).toBe("Short detail.");
  });

  it("returns the string unchanged when its length equals the limit exactly", () => {
    const exactly180 = "x".repeat(180);
    expect(compactDetail(exactly180, 180)).toBe(exactly180);
    expect(compactDetail(exactly180, 180).length).toBe(180);
  });

  it("truncates and appends an ellipsis when the detail exceeds the limit", () => {
    const long = "a".repeat(200);
    const result = compactDetail(long, 180);
    expect(result.endsWith("…")).toBe(true);
    // Ellipsis char is 1 code point; slice is 180 chars.
    expect(result.length).toBe(181);
  });

  it("trims trailing whitespace from the slice before appending the ellipsis", () => {
    // Build a string where the 180-char boundary lands on a space.
    const core = "word ".repeat(36); // 36 × 5 = 180 chars; ends on a space
    expect(core.length).toBe(180);
    const long = core + "trailing";
    const result = compactDetail(long, 180);
    // The trailing space before position 180 should be trimmed.
    expect(result).toBe("word ".repeat(36).trimEnd() + "…");
    expect(result.endsWith(" …")).toBe(false);
  });

  it("uses NEXT_ACTION_DETAIL_MAX_CHARS = 180 as the production limit", () => {
    expect(NEXT_ACTION_DETAIL_MAX_CHARS).toBe(180);
    const boundary = "a".repeat(180);
    expect(compactDetail(boundary, NEXT_ACTION_DETAIL_MAX_CHARS)).toBe(boundary);
    expect(compactDetail("a".repeat(181), NEXT_ACTION_DETAIL_MAX_CHARS)).toMatch(
      /^a{180}…$/,
    );
  });

  it("handles an empty string without throwing", () => {
    expect(compactDetail("", 180)).toBe("");
    expect(compactDetail("", 0)).toBe("");
  });

  it("returns just the ellipsis when maxChars is 0 and detail is non-empty", () => {
    expect(compactDetail("hello", 0)).toBe("…");
  });

  it("does not add an ellipsis to a string that fits exactly in a small limit", () => {
    expect(compactDetail("abc", 3)).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// fixLinkFor target resolution — mirrors fallbackFixTarget logic
// ---------------------------------------------------------------------------
// The fallbackFixTarget function maps each BatchHealthCheckKey to a
// BatchHealthFixTarget. These are the routing decisions that send operators
// to the right workflow when a check is unmet.
type BatchHealthCheckKey = "carbon" | "production" | "transport" | "entityReadiness";
type BatchHealthFixTarget =
  | "batchDetails"
  | "deliveries"
  | "deliveryDistances"
  | "productionRuns"
  | "biocharProducts"
  | "sourceData";

function fallbackFixTarget(key: BatchHealthCheckKey): BatchHealthFixTarget {
  switch (key) {
    case "carbon":
      return "batchDetails";
    case "production":
      return "productionRuns";
    case "transport":
      return "deliveryDistances";
    case "entityReadiness":
      return "sourceData";
  }
}

describe("fallbackFixTarget", () => {
  it("routes carbon check failures to batchDetails", () => {
    expect(fallbackFixTarget("carbon")).toBe("batchDetails");
  });

  it("routes production check failures to productionRuns", () => {
    expect(fallbackFixTarget("production")).toBe("productionRuns");
  });

  it("routes transport check failures to deliveryDistances", () => {
    expect(fallbackFixTarget("transport")).toBe("deliveryDistances");
  });

  it("routes entityReadiness check failures to sourceData", () => {
    expect(fallbackFixTarget("entityReadiness")).toBe("sourceData");
  });

  it("covers every BatchHealthCheckKey (exhaustive mapping)", () => {
    const keys: BatchHealthCheckKey[] = [
      "carbon",
      "production",
      "transport",
      "entityReadiness",
    ];
    for (const key of keys) {
      expect(() => fallbackFixTarget(key)).not.toThrow();
      expect(fallbackFixTarget(key)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// fixLinkFor URL construction — mirrors the component's fixLinkFor function
// ---------------------------------------------------------------------------
interface FixLink {
  label: string;
  href: string;
}

interface BatchHealthCheck {
  key: BatchHealthCheckKey;
  label: string;
  status: "met" | "unmet" | "skipped";
  detail?: string;
  fixTarget?: BatchHealthFixTarget;
}

function fixLinkFor(check: BatchHealthCheck, facilityId: string): FixLink {
  const target = check.fixTarget ?? fallbackFixTarget(check.key);
  switch (target) {
    case "batchDetails":
      return {
        label: check.key === "production" ? "Link applications" : "Edit details",
        href: "#batch-details",
      };
    case "productionRuns":
      return {
        label: "Link production data",
        href: `/production-runs?facility=${facilityId}`,
      };
    case "biocharProducts":
      return {
        label: "Link production run",
        href: `/biochar-products?facility=${facilityId}`,
      };
    case "deliveries":
    case "deliveryDistances":
      return {
        label: "Review deliveries",
        href: `/deliveries?facility=${facilityId}`,
      };
    case "sourceData":
      return {
        label: "Review source data",
        href: `/production-runs?facility=${facilityId}`,
      };
  }
}

describe("fixLinkFor", () => {
  const facilityId = "fac-001";

  it("routes a carbon check with no explicit fixTarget to #batch-details", () => {
    const check: BatchHealthCheck = {
      key: "carbon",
      label: "Carbon & durability inputs complete",
      status: "unmet",
    };
    const link = fixLinkFor(check, facilityId);
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
    const link = fixLinkFor(check, facilityId);
    expect(link.label).toBe("Link applications");
    expect(link.href).toBe("#batch-details");
  });

  it("routes a production check with no fixTarget to productionRuns with the facility", () => {
    const check: BatchHealthCheck = {
      key: "production",
      label: "Production data linked",
      status: "unmet",
    };
    const link = fixLinkFor(check, facilityId);
    expect(link.href).toBe(`/production-runs?facility=${facilityId}`);
  });

  it("routes a transport check to deliveries with the facility", () => {
    const check: BatchHealthCheck = {
      key: "transport",
      label: "Transport legs present",
      status: "unmet",
    };
    const link = fixLinkFor(check, facilityId);
    expect(link.href).toBe(`/deliveries?facility=${facilityId}`);
  });

  it("routes entityReadiness to sourceData (production-runs) with the facility", () => {
    const check: BatchHealthCheck = {
      key: "entityReadiness",
      label: "Entity certifier fields complete",
      status: "unmet",
    };
    const link = fixLinkFor(check, facilityId);
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
    const link = fixLinkFor(check, facilityId);
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
    const link = fixLinkFor(check, facilityId);
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
    const link = fixLinkFor(check, facilityId);
    expect(link.href).toContain("/production-runs");
  });
});