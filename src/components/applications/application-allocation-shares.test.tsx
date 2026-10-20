// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { ApplicationAllocationShare } from "@/data-access/delivery-allocation-provenance";
import { ApplicationAllocationShares } from "./application-allocation-shares";

afterEach(cleanup);

function share(productId: string, productCode: string, runId: string, runCode: string, dryMassKg: number): ApplicationAllocationShare {
  return { applicationId: "application", deliveryId: "delivery", biocharProductId: productId, productCode, productionRunId: runId, productionRunCode: runCode, dryMassKg, wetMassKg: dryMassKg * 2 };
}

const shares = [
  share("product-a", "BP-26-001", "run-a", "PR-26-001", 450),
  share("product-a", "BP-26-001", "run-b", "PR-26-002", 150),
  share("product-b", "BP-26-002", "run-c", "PR-26-003", 125),
];

it("carries the bar and its key inline, and the ledger and run split behind the (i)", async () => {
  const { container } = render(<ApplicationAllocationShares shares={shares} />);
  const inline = container.textContent ?? "";
  // The key line names each batch and its dry mass, so the block already
  // answers which batches were applied without the ledger's percentages.
  expect(inline).toContain("BP-26-001");
  expect(inline).toContain("600 kg");
  expect(inline).toContain("125 kg");
  expect(inline).not.toContain("% of total");
  expect(inline).not.toContain("PR-26-001");

  fireEvent.click(screen.getByRole("button", { name: "About Applied batches" }));
  expect(await screen.findByText("% of total")).toBeTruthy();
  const runs = screen.getByLabelText("Source production runs per applied batch");
  expect(within(runs).getByText(/PR-26-001/)).toBeTruthy();
  expect(within(runs).getByText(/450 kg/)).toBeTruthy();
  expect(within(runs).getByText(/PR-26-003/)).toBeTruthy();
});

it("gives each applied batch its own accent so adjacent blocks stay distinguishable", () => {
  render(<ApplicationAllocationShares shares={shares} />);
  const bar = screen.getByRole("img");
  const fills = [...bar.children].map(child => (child as HTMLElement).style.background);
  expect(fills).toEqual(["var(--acc-prod)", "var(--acc-infra)"]);
});

it("renders nothing when no batch was traced", () => {
  const { container } = render(<ApplicationAllocationShares shares={[]} />);
  expect(container.innerHTML).toBe("");
});
