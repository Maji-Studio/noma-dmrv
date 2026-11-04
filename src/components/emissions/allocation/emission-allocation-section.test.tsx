// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmissionAllocation } from "@/types/emission-allocation";
import { BATCH_A, BATCH_B, REMOVAL_1, allocationFixture } from "./allocation-test-fixtures";

const state = vi.hoisted(() => ({ data: undefined as unknown, error: null as Error | null, refetch: vi.fn() }));
vi.mock("@/hooks/use-emission-allocation", () => ({
  useEmissionAllocation: () => ({ data: state.data, error: state.error, refetch: state.refetch }),
}));

import { EmissionAllocationSection } from "./emission-allocation-section";

const show = (props: { creditBatchId: string } | { removalId: string }, params = "") =>
  render(
    <NuqsTestingAdapter searchParams={params}>
      <EmissionAllocationSection {...props} />
    </NuqsTestingAdapter>,
  );

beforeEach(() => {
  state.data = allocationFixture();
  state.error = null;
});
afterEach(cleanup);

describe("EmissionAllocationSection, Flow view", () => {
  it("opens on Flow and lists what the page's batch carries with hint A", () => {
    show({ creditBatchId: BATCH_A });
    expect(screen.getByRole("button", { name: "Flow" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("allocation-flow")).toBeTruthy();
    expect(screen.getByText("Used 2,000 of 10,000 kg")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
  });

  it("opens the table from the detail list", () => {
    show({ creditBatchId: BATCH_A });
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    expect(screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("EmissionAllocationSection, Table view on a batch", () => {
  it("renders every group with records from the response", () => {
    show({ creditBatchId: BATCH_A }, "?allocation=table");
    for (const title of ["Feedstock transport", "Production runs", "Biochar delivery transport", "Manual entries"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getAllByText("FS-26-002").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DL-26-001").length).toBeGreaterThan(0);
  });

  it("shows the hint A marker and opens where the kilograms went", () => {
    show({ creditBatchId: BATCH_A }, "?allocation=table");
    expect(screen.getAllByText("Used 2,000 of 10,000 kg").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "About FS-26-001 transport" })[0]);
    expect(document.body.textContent).toContain("CB-26-001 carries the whole 1,000 t·km because its run PR-26-001 drew from FS-26-001 first, on 4 Feb.");
    const table = screen.getByText("Where the 10,000 kg went").closest("table")!;
    expect(within(table).getByText("PR-26-001. Carries it")).toBeTruthy();
    expect(within(table).getByText("PR-26-004")).toBeTruthy();
    expect(within(table).getByText("Lost")).toBeTruthy();
    expect(within(table).getByText("Still in North bay")).toBeTruthy();
  });

  it("keeps a zero-fraction batch visible as Counted on at 0%", () => {
    show({ creditBatchId: BATCH_B }, "?allocation=table");
    expect(screen.getAllByText("Counted on").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CB-26-001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Used 3,000 of 10,000 kg").length).toBeGreaterThan(0);
  });

  it("shows an unrecorded quantity as Not recorded, never zero, and names a manual entry by its component", () => {
    show({ creditBatchId: BATCH_A }, "?allocation=table");
    expect(screen.getAllByText("Chipper electricity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 kWh")).toBeNull();
  });

  it("calls a run by its reactor code and not-yet-allocated records by Not yet allocated", () => {
    show({ creditBatchId: BATCH_A }, "?allocation=table");
    expect(screen.getAllByText(/RX-1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not yet allocated").length).toBeGreaterThan(0);
  });
});

describe("EmissionAllocationSection, Removal surface", () => {
  it("sums the Removal's batches and puts the rest under Not yet allocated", () => {
    show({ removalId: REMOVAL_1 }, "?allocation=table");
    // The 60/40 delivery is one whole record on the Removal.
    const delivery = screen.getAllByText("DL-26-001")[0].closest("tr")!;
    expect(within(delivery).getAllByText("360 t·km").length).toBeGreaterThan(0);
    expect(within(delivery).getAllByText("100%").length).toBeGreaterThan(0);
    // A run on a batch no Removal lists, and an untouched delivery, are not allocated to RM-26-001.
    expect(screen.getAllByText("not yet allocated").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RM-26-001:", { exact: false }).length).toBeGreaterThan(0);
  });
});

describe("EmissionAllocationSection, states", () => {
  it("shows an error with a retry", () => {
    state.data = undefined;
    state.error = new Error("Could not read the allocation.");
    show({ creditBatchId: BATCH_A });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.refetch).toHaveBeenCalled();
    expect(screen.getByText("Could not read the allocation.")).toBeTruthy();
  });

  it("shows an empty state when nothing causes emissions yet", () => {
    state.data = { ...allocationFixture(), records: [] } satisfies EmissionAllocation;
    show({ creditBatchId: BATCH_A });
    expect(screen.getByText("No emission sources yet")).toBeTruthy();
  });
});
