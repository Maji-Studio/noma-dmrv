import { describe, expect, it } from "vitest";
import { batchHealthFixLinkFor } from "./batch-health-links";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { removalFindingFixLink } from "./removal-finding-links";

describe("removalFindingFixLink", () => {
  it("reuses the batch health link for the finding's fix target", () => {
    expect(removalFindingFixLink({ fixTarget: "templateLineReview" }, "fac-1")).toEqual(
      batchHealthFixLinkFor({ key: "template", fixTarget: "templateLineReview" }, "fac-1"),
    );
    expect(removalFindingFixLink({ fixTarget: "feedstockTypes" }, "fac-1")?.href).toContain("fac-1");
  });

  it("gives no link when several destinations coexist", () => {
    expect(removalFindingFixLink({ fixTarget: null }, "fac-1")).toBeNull();
  });

  it("resolves batch-level targets to the only member batch", () => {
    expect(removalFindingFixLink({ fixTarget: "creditBatchTemplate" }, "fac-1", ["b1"])).toEqual(
      batchHealthFixLinkFor({ key: "template", fixTarget: "creditBatchTemplate" }, "fac-1", "b1"),
    );
    expect(removalFindingFixLink({ fixTarget: "batchDetails" }, "fac-1", ["b1"])?.href).toBe(
      creditBatchDeepLinkHref("b1", "fac-1"),
    );
  });

  it("falls back to the credit batch list and never returns an anchor", () => {
    for (const ids of [[], ["b1", "b2"]]) {
      const link = removalFindingFixLink({ fixTarget: "batchDetails" }, "fac-1", ids);
      expect(link?.href).toBe("/credit-batches?facility=fac-1");
    }
    expect(removalFindingFixLink({ fixTarget: "creditBatchTemplate" }, "fac-1", ["b1", "b2"])?.href).toBe(
      batchHealthFixLinkFor({ key: "template", fixTarget: "creditBatchTemplate" }, "fac-1")?.href,
    );
  });
});
