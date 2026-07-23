import { describe, expect, it } from "vitest";
import type { BatchHealthCheck } from "@/lib/certification/batch-health";
import {
  batchHealthFixLinkFor,
  compactBatchHealthDetail,
  fallbackBatchHealthFixTarget,
  NEXT_ACTION_DETAIL_MAX_CHARS,
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
  it("routes carbon check failures to labSamples (where lab inputs are entered)", () => {
    expect(fallbackBatchHealthFixTarget("carbon")).toBe("labSamples");
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

  // The link routing depends only on the check's key + explicit fixTarget, so
  // tests construct just those (matching the function's narrowed input).
  const check = (
    key: BatchHealthCheck["key"],
    fixTarget?: BatchHealthCheck["fixTarget"],
    affectedRecords?: BatchHealthCheck["affectedRecords"],
  ): Pick<BatchHealthCheck, "key" | "fixTarget" | "affectedRecords"> => ({
    key,
    fixTarget,
    affectedRecords,
  });

  it("routes a carbon check with no explicit fixTarget to Lab Samples", () => {
    const link = batchHealthFixLinkFor(check("carbon"), facilityId);
    expect(link.label).toBe("Add lab sample data");
    expect(link.href).toBe(`/samples?facility=${facilityId}`);
  });

  it("routes an explicit applications fixTarget to the applications page", () => {
    // The noApplications production gap routes here: applications auto-match by
    // crediting period, so there is no manual "link" action to offer.
    const link = batchHealthFixLinkFor(
      check("production", "applications"),
      facilityId,
    );
    expect(link.label).toBe("Review applications");
    expect(link.href).toBe(`/applications?facility=${facilityId}`);
  });

  it("uses 'Edit details' label for an explicit batchDetails fixTarget", () => {
    const link = batchHealthFixLinkFor(
      check("production", "batchDetails"),
      facilityId,
    );
    expect(link.label).toBe("Edit details");
    expect(link.href).toBe("#batch-details");
  });

  it("routes a production check with no fixTarget to productionRuns with the facility", () => {
    const link = batchHealthFixLinkFor(check("production"), facilityId);
    expect(link.href).toBe(`/production-runs?facility=${facilityId}`);
  });

  it("filters a production-run issue to only the affected runs", () => {
    const link = batchHealthFixLinkFor(
      check("entityReadiness", "productionRuns", [
        { id: "run-1", code: "PR-1", missing: ["Electricity"] },
        { id: "run-2", code: "PR-2", missing: ["Meter evidence"] },
      ]),
      facilityId,
    );

    expect(link.label).toBe("Fix 2 production runs");
    expect(link.href).toBe(
      `/production-runs?facility=${facilityId}&ids=run-1%2Crun-2`,
    );
  });

  it("routes a transport check to deliveries with the facility", () => {
    const link = batchHealthFixLinkFor(check("transport"), facilityId);
    expect(link.href).toBe(`/deliveries?facility=${facilityId}`);
  });

  it("routes entityReadiness to sourceData (production-runs) with the facility", () => {
    const link = batchHealthFixLinkFor(check("entityReadiness"), facilityId);
    expect(link.href).toContain("/production-runs");
    expect(link.href).toContain(facilityId);
  });

  it("routes an explicit biocharProducts fixTarget to biochar-products", () => {
    const link = batchHealthFixLinkFor(
      check("production", "biocharProducts"),
      facilityId,
    );
    expect(link.href).toBe(`/biochar-products?facility=${facilityId}`);
    expect(link.label).toBe("Link production run");
  });

  it("routes an explicit deliveries fixTarget to deliveries with the facility", () => {
    const link = batchHealthFixLinkFor(
      check("transport", "deliveries"),
      facilityId,
    );
    expect(link.href).toBe(`/deliveries?facility=${facilityId}`);
  });

  it("deep-links feedstock transport evidence to the affected feedstock", () => {
    const feedstockId = "11111111-1111-4111-8111-111111111111";
    const link = batchHealthFixLinkFor(
      check("entityReadiness", "feedstocks", [
        {
          id: feedstockId,
          code: "feedstock transport 1",
          missing: ["Transport evidence"],
        },
      ]),
      facilityId,
    );

    expect(link.label).toBe("Review feedstock transport");
    expect(link.href).toBe(
      `/feedstocks?facility=${facilityId}&feedstock=${feedstockId}&mode=edit&focus=transport-evidence`,
    );
  });

  it("prefers an explicit fixTarget over the fallback", () => {
    // carbon normally falls back to batchDetails, but an explicit override wins.
    const link = batchHealthFixLinkFor(
      check("carbon", "sourceData"),
      facilityId,
    );
    expect(link.href).toContain("/production-runs");
  });

});
