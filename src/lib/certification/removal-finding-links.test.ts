import { describe, expect, it } from "vitest";
import { batchHealthFixLinkFor } from "./batch-health-links";
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
});
