// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationAllocationShares } from "./application-allocation-shares";

afterEach(cleanup);

describe("application allocation display", () => {
  it("totals each batch in the ledger and keeps the shared run, both behind the (i)", async () => {
    const { container } = render(createElement(ApplicationAllocationShares, { shares: [
      { applicationId: "app", deliveryId: "delivery", biocharProductId: "A", productCode: "A", productionRunId: "shared", productionRunCode: "RUN", wetMassKg: 785.714, dryMassKg: 450 },
      { applicationId: "app", deliveryId: "delivery", biocharProductId: "B", productCode: "B", productionRunId: "shared", productionRunCode: "RUN", wetMassKg: 214.286, dryMassKg: 125 },
    ] }));
    // The key line carries each batch's mass; the shares wait in the panel.
    expect(container.textContent).toContain("450 kg");
    expect(container.textContent).toContain("125 kg");
    expect(container.textContent).not.toContain("78.3%");
    fireEvent.click(screen.getByRole("button", { name: "About Applied batches" }));
    expect((await screen.findAllByText("78.3%")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("21.7%").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Source production runs per applied batch")).toBeTruthy();
    expect(screen.getAllByText(/RUN/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(" · ");
  });
});
