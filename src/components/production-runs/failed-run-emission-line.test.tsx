// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";
import { FailedRunEmissionTodosView } from "@/components/credit-batches/failed-run-emission-todos";
import { FailedRunEmissionLineView, FailedRunSheetEmissionsView } from "./failed-run-emission-line";

afterEach(cleanup);

const BASE: FailedRunEmissionGuidance = {
  productionRunId: "run-1", runCode: "PR-26-001", facilityId: "fac-1", endDay: "2026-10-02",
  feedstockTypeId: "ft-1", feedstockTypeName: "Forestry waste", state: "attached",
  batch: { id: "b-oct", code: "CB-26-010-A" }, href: "/x",
};
const NO_MATCH = { ...BASE, state: "no-match" as const, batch: null, href: "/credit-batches?facility=fac-1" };
const MIXED = { ...BASE, productionRunId: "run-2", runCode: "PR-26-002", state: "mixed-feedstock" as const, batch: null, feedstockTypeName: null, href: "/production-runs/run-2" };

describe("read sheet emissions line", () => {
  it("says nothing for a counted run: its batch is listed under Used by", () => {
    const { container } = render(<FailedRunEmissionLineView guidance={BASE} />);
    expect(container.textContent).toBe("");
  });

  it("says no credit batch yet with one link", () => {
    render(<FailedRunEmissionLineView guidance={NO_MATCH} />);
    expect(screen.getByText("No credit batch for its emissions yet")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("link", { name: "Open credit batches" }).getAttribute("href")).toBe("/credit-batches?facility=fac-1");
  });

  it("warns on mixed and empty feedstock with no link to the sheet it is on", () => {
    const { container, rerender } = render(<FailedRunEmissionLineView guidance={MIXED} />);
    expect(screen.getByRole("status").textContent).toContain("Its feedstock records hold more than one feedstock type.");
    expect(container.querySelector('[data-tone="warning"]')).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<FailedRunEmissionLineView guidance={{ ...MIXED, state: "empty-feedstock" }} />);
    expect(screen.getByRole("status").textContent).toContain("Its emissions have no feedstock type.");
    expect(container.querySelector('[data-tone="warning"]')).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("names a failed check with Try again that re-reads", () => {
    const onRetry = vi.fn();
    render(<FailedRunSheetEmissionsView guidance={undefined} isError isFetching={false} onRetry={onRetry} />);
    expect(screen.getByRole("status").textContent).toContain("Couldn't check where its emissions count.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("facility to-do", () => {
  it("lists each unresolved failed run under one count", () => {
    render(<FailedRunEmissionTodosView items={[NO_MATCH, MIXED]} facilityId="fac-1" />);
    expect(screen.getByText("2 failed runs have emissions without a credit batch")).toBeTruthy();
    expect(screen.getByRole("link", { name: /PR-26-001/ })).toBeTruthy();
    expect(screen.getByText(/create a credit batch for Forestry waste that covers Oct 2, 2026/)).toBeTruthy();
    expect(screen.getByText(/review its feedstock sources so they hold one feedstock type/)).toBeTruthy();
  });

  it("renders nothing when every failed run has its batch or there are none", () => {
    const { container } = render(<FailedRunEmissionTodosView items={[]} facilityId="fac-1" />);
    expect(container.textContent).toBe("");
  });
});
