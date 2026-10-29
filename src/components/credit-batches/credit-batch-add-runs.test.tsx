// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { CreditBatchAddRuns } from "./credit-batch-add-runs";

afterEach(cleanup);

const run = {
  id: "run-1", code: "PR-0415", date: "2026-04-15", status: "completed",
  biocharOutputKg: 100, biocharDryMassKg: 95, biocharStorageName: "Pile A",
} as unknown as CreditBatchProductionRunOption;

describe("CreditBatchAddRuns", () => {
  it("shows a run as the list above does, with Add run after the mass and no dashed border", () => {
    const onAdd = vi.fn();
    render(<CreditBatchAddRuns runs={[run]} facilityId="facility-1" onAdd={onAdd} />);
    const row = within(screen.getByTestId("credit-batch-add-run")).getByTestId("credit-batch-production-run-preview");
    expect(row.className).not.toContain("dashed");
    expect(within(row).getByText("PR-0415")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Add run PR-0415" }));
    expect(onAdd).toHaveBeenCalledWith("run-1");
  });

  it("says so with an empty state when nothing is left to add", () => {
    render(<CreditBatchAddRuns runs={[]} onAdd={vi.fn()} />);
    expect(within(screen.getByTestId("credit-batch-add-runs-empty")).getByText("No other completed runs to add")).toBeTruthy();
  });
});
