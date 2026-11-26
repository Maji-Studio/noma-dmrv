import { describe, expect, it } from "vitest";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";
import { describeCreditBatchPreview } from "./production-run-credit-batch-preview-copy";

const BASE: FailedRunEmissionGuidance = {
  productionRunId: "run-1", runCode: "PR-26-001", facilityId: "fac-1", endDay: "2026-10-02",
  feedstockTypeId: "ft-1", feedstockTypeName: "Forestry waste", state: "attached",
  batch: { id: "b-oct", code: "CB-26-010-A" }, href: "/credit-batches/b-oct",
};
const NO_MATCH = { ...BASE, state: "no-match" as const, batch: null, href: "/credit-batches?facility=fac-1" };
const MIXED = { ...BASE, state: "mixed-feedstock" as const, batch: null, feedstockTypeId: null, feedstockTypeName: null, href: "/production-runs/run-1" };

describe("the form footer for failed and cancelled runs", () => {
  it("shows the saved failed run's attachment before the material state", () => {
    const copy = describeCreditBatchPreview({ state: "not-applicable", status: "failed", savedEmissionAttachment: BASE });
    expect(copy.lead).toBe("Emissions count in credit batch ");
    expect(copy.batches).toEqual([{ id: "b-oct", code: "CB-26-010-A" }]);
    expect(copy.lead).not.toContain("Not applicable");
  });

  it("explains an unmatched failed run in the (i)", () => {
    const copy = describeCreditBatchPreview({ state: "not-applicable", status: "failed", savedEmissionAttachment: NO_MATCH });
    expect(copy.lead).toBe("No credit batch for its emissions yet");
    expect(copy.info).toContain("You can save the run now.");
  });

  it("warns for mixed feedstock", () => {
    const copy = describeCreditBatchPreview({ state: "not-applicable", status: "failed", savedEmissionAttachment: MIXED });
    expect(copy.tone).toBe("warning");
    expect(copy.lead).toContain("more than one feedstock type");
  });

  it("tells a new failed run its emissions count by end day, without naming a batch", () => {
    const copy = describeCreditBatchPreview({ state: "not-applicable", status: "failed" });
    expect(copy.lead).toBe("Emissions count in the credit batch for its end day");
    expect(copy.batches).toEqual([]);
  });

  it("keeps Cancelled as Not applicable", () => {
    const copy = describeCreditBatchPreview({ state: "not-applicable", status: "cancelled" });
    expect(copy.lead).toBe("Credit batch: Not applicable");
    expect(copy.info).toBe("A cancelled run does not join a credit batch.");
  });
});
