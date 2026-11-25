import { describe, expect, it } from "vitest";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";
import { describeCreditBatchPreview } from "./production-run-credit-batch-preview-copy";
import { describeFailedRunEmissions, describeFailedRunEmissionTodo, failedRunEmissionTodoTitle } from "./failed-run-emission-copy";

const BASE: FailedRunEmissionGuidance = {
  productionRunId: "run-1", runCode: "PR-26-001", facilityId: "fac-1", endDay: "2026-10-02",
  feedstockTypeId: "ft-1", feedstockTypeName: "Forestry waste", state: "attached",
  batch: { id: "b-oct", code: "CB-26-010-A" }, message: "", href: "/credit-batches/b-oct",
};
const NO_MATCH = { ...BASE, state: "no-match" as const, batch: null, href: "/credit-batches?facility=fac-1" };
const MIXED = { ...BASE, state: "mixed-feedstock" as const, batch: null, feedstockTypeId: null, feedstockTypeName: null, href: "/production-runs/run-1" };
const EMPTY = { ...MIXED, state: "empty-feedstock" as const };

describe("failed run emissions copy", () => {
  it("names the attached batch", () => {
    const copy = describeFailedRunEmissions(BASE);
    expect(copy).toMatchObject({ lead: "Emissions count in credit batch ", batch: { code: "CB-26-010-A" }, tone: "neutral", action: null });
    expect(copy.info).toContain("Oct 2, 2026");
    expect(copy.info).toContain("adds no biochar");
  });

  it("says no credit batch yet and points to the credit batches", () => {
    const copy = describeFailedRunEmissions(NO_MATCH);
    expect(copy).toMatchObject({ lead: "No credit batch for its emissions yet", batch: null, action: { label: "Open credit batches" } });
    expect(copy.info).toContain("No credit batch for Forestry waste covers Oct 2, 2026 yet.");
  });

  it("asks for a review of mixed and empty feedstock with one plain line", () => {
    expect(describeFailedRunEmissions(MIXED)).toMatchObject({ lead: "Its feedstock records hold more than one feedstock type.", tone: "warning", action: { label: "Review feedstock sources" } });
    expect(describeFailedRunEmissions(EMPTY)).toMatchObject({ lead: "Its emissions have no feedstock type.", action: { label: "Review feedstock sources" } });
  });

  it("writes the facility to-do rows", () => {
    expect(describeFailedRunEmissionTodo(NO_MATCH)).toBe("create a credit batch for Forestry waste that covers Oct 2, 2026.");
    expect(describeFailedRunEmissionTodo(MIXED)).toContain("more than one feedstock type");
    expect(failedRunEmissionTodoTitle(1)).toBe("1 failed run has emissions without a credit batch");
    expect(failedRunEmissionTodoTitle(3)).toBe("3 failed runs have emissions without a credit batch");
  });

  it("never uses an en or em dash", () => {
    const all = [BASE, NO_MATCH, MIXED, EMPTY].flatMap((g) => {
      const c = describeFailedRunEmissions(g);
      return [c.lead, c.info, c.action?.label ?? "", describeFailedRunEmissionTodo(g)];
    });
    for (const text of all) expect(text).not.toMatch(/[–—]/);
  });
});

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
