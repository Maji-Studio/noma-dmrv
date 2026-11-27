import { describe, expect, it } from "vitest";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";
import { describeFailedRunEmissions, describeFailedRunEmissionTodo, failedRunEmissionTodoTitle, failedRunEmissionTodoRowTitle, FAILED_RUN_EMISSION_GROUP_TITLE } from "./failed-run-emission-copy";

const BASE: FailedRunEmissionGuidance = {
  productionRunId: "run-1", runCode: "PR-26-001", facilityId: "fac-1", endDay: "2026-10-02",
  feedstockTypeId: "ft-1", feedstockTypeName: "Forestry waste", state: "attached",
  batch: { id: "b-oct", code: "CB-26-010-A" }, href: "/credit-batches/b-oct",
};
const NO_MATCH = { ...BASE, state: "no-match" as const, batch: null, href: "/credit-batches?facility=fac-1" };
const MIXED = { ...BASE, state: "mixed-feedstock" as const, batch: null, feedstockTypeId: null, feedstockTypeName: null, href: "/production-runs/run-1" };
const EMPTY = { ...MIXED, state: "empty-feedstock" as const };

describe("failed run emissions copy", () => {
  it("names the attached batch", () => {
    const copy = describeFailedRunEmissions(BASE);
    expect(copy).toMatchObject({ lead: "Emissions count in credit batch ", batch: { code: "CB-26-010-A" }, tone: "neutral", action: null });
    expect(copy.info).toContain("Oct 2, 2026");
    expect(copy.info).toContain("output stays in its uncarbonized bin");
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
    expect(describeFailedRunEmissionTodo(MIXED)).toBe("review its feedstock sources so they hold one feedstock type.");
    expect(describeFailedRunEmissionTodo(EMPTY)).toBe("give its feedstock sources a feedstock type.");
    expect(failedRunEmissionTodoTitle(1)).toBe("1 failed run has emissions without a credit batch");
    expect(failedRunEmissionTodoTitle(3)).toBe("3 failed runs have emissions without a credit batch");
  });

  it("never uses an en or em dash", () => {
    const all = [BASE, NO_MATCH, MIXED, EMPTY].flatMap((g) => {
      const c = describeFailedRunEmissions(g);
      return [c.lead, c.info, c.action?.label ?? "", describeFailedRunEmissionTodo(g),
        ...(g.state === "attached" ? [] : [failedRunEmissionTodoRowTitle(g.state)])];
    });
    all.push(FAILED_RUN_EMISSION_GROUP_TITLE);
    for (const text of all) expect(text).not.toMatch(/[–—]/);
  });
});

it.each([
  ["no-match", "Emissions without a credit batch"],
  ["mixed-feedstock", "Emissions need one feedstock type"],
  ["empty-feedstock", "Emissions need a feedstock type"],
] as const)("names the %s to-do", (state, title) => {
  expect(failedRunEmissionTodoRowTitle(state)).toBe(title);
});

it("names the failed-emission group", () => {
  expect(FAILED_RUN_EMISSION_GROUP_TITLE).toBe("Failed run emissions without a credit batch");
});
