// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmissionAllocation } from "@/types/emission-allocation";
import { BATCH_A, BATCH_B, MANY_DELIVERIES, REMOVAL_1, allocationFixture, manyDeliveriesFixture } from "./allocation-test-fixtures";

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

describe("EmissionAllocationSection, Flow view (share bars)", () => {
  const rowOf = (key: string) => document.querySelector(`[data-share-row="${key}"]`) as HTMLElement;

  it("opens on Flow with one row per visible quantity, each with this page's figure and share", () => {
    show({ creditBatchId: BATCH_A });
    expect((screen.getByRole("radio", { name: "Flow" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("allocation-share-bars")).toBeTruthy();
    expect(["feedstock", "delivery", "diesel", "electricity"].map((key) => rowOf(key) !== null)).toEqual([true, true, true, true]);
    expect(rowOf("manual")).toBeNull();
    expect(screen.getByRole("button", { name: (name) => name.startsWith("Feedstock transport: 1,000 t·km \u00b7 81%") })).toBeTruthy();
    expect(screen.getByRole("button", { name: (name) => name.startsWith("Biochar delivery transport: 216 t·km \u00b7 60%") })).toBeTruthy();
  });

  it("has no quantity tabs, no second Open table link and keeps the records closed at rest", () => {
    show({ creditBatchId: BATCH_A });
    expect(screen.queryByRole("radio", { name: "Feedstock" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open table" })).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();
  });

  it("summarises the hint and the records with no figure under the bar", () => {
    show({ creditBatchId: BATCH_A });
    expect(within(rowOf("feedstock")).getByText("1 partly used")).toBeTruthy();
    expect(within(rowOf("electricity")).getByText("1 with no recorded electricity")).toBeTruthy();
  });

  it("opens a row's records in place with the hint marker and a Total", () => {
    show({ creditBatchId: BATCH_A });
    fireEvent.click(screen.getByRole("button", { name: /^Feedstock transport:/ }));
    expect(screen.getByText("Used 2,000 of 10,000 kg")).toBeTruthy();
    expect(within(rowOf("feedstock")).getByText("Total")).toBeTruthy();
    expect(rowOf("delivery").textContent).not.toContain("DL-26-001 ");
    fireEvent.click(screen.getByRole("button", { name: /^Feedstock transport:/ }));
    expect(within(rowOf("feedstock")).queryByText("Total")).toBeNull();
  });

  it("gives no Total when no record in the open row has a figure", () => {
    const data = allocationFixture();
    data.records = data.records.map((record) => ({ ...record, quantities: record.quantities.map((quantity) => (quantity.unit === "kWh" ? { ...quantity, value: null } : quantity)) }));
    state.data = data;
    show({ creditBatchId: BATCH_A });
    fireEvent.click(screen.getByRole("button", { name: /^Electricity:/ }));
    expect(within(rowOf("electricity")).getAllByText("Not recorded").length).toBeGreaterThan(1);
    expect(within(rowOf("electricity")).queryByText("Total")).toBeNull();
  });

  it("lists a record with no figure in its open row as Not recorded", () => {
    show({ creditBatchId: BATCH_A });
    fireEvent.click(screen.getByRole("button", { name: /^Electricity:/ }));
    expect(within(rowOf("electricity")).getByText("Not recorded")).toBeTruthy();
  });

  it("reads a quantity recorded only as 0 as 0, not as nothing recorded", () => {
    const data = allocationFixture();
    data.records = data.records.map((record) => ({ ...record, quantities: record.quantities.map((quantity) => (quantity.unit === "L" ? { ...quantity, value: 0 } : quantity)) }));
    state.data = data;
    show({ creditBatchId: BATCH_A });
    expect(within(rowOf("diesel")).getByText("Every recorded figure is 0")).toBeTruthy();
    expect(within(rowOf("diesel")).getByText("0 L")).toBeTruthy();
  });

  it("shows the first 3 records of a busy quantity, then Show all N", () => {
    state.data = manyDeliveriesFixture();
    show({ creditBatchId: BATCH_A });
    fireEvent.click(screen.getByRole("button", { name: /^Feedstock transport:/ }));
    const row = rowOf("feedstock");
    expect(within(row).getAllByRole("row")).toHaveLength(1 + 3 + 1);
    fireEvent.click(within(row).getByRole("button", { name: `Show all ${MANY_DELIVERIES}` }));
    expect(within(row).getAllByRole("row")).toHaveLength(1 + MANY_DELIVERIES + 1);
    expect(within(row).queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("keeps a later-touching batch's Counted on summary reachable when it carries no transport", () => {
    show({ creditBatchId: BATCH_B });
    expect(within(rowOf("feedstock")).getByText("1 counted on CB-26-001")).toBeTruthy();
  });

  it("lists manual transport as its own row", () => {
    const data = allocationFixture();
    data.records.push({ ...data.records.find((r) => r.id === "me-1")!, id: "me-2", detail: { kind: "manual", creditBatchId: BATCH_A, componentId: "c2", componentName: "Hauling", kindOfEntry: "value", omittedInputKeys: [] }, quantities: [{ value: 90, unit: "t·km", label: "Transport" }] });
    state.data = data;
    show({ creditBatchId: BATCH_A });
    expect(screen.getByRole("button", { name: (name) => name.startsWith("Manual transport: 90 t·km \u00b7 100%") })).toBeTruthy();
  });

  it("says what fills a quantity nothing records, without a toggle", () => {
    const data = allocationFixture();
    data.records = data.records.filter((record) => record.group !== "deliveryTransport");
    state.data = data;
    show({ creditBatchId: BATCH_A });
    expect(within(rowOf("delivery")).getByText("Shows once a biochar delivery has its distance and mass recorded.")).toBeTruthy();
    expect(within(rowOf("delivery")).queryByRole("button")).toBeNull();
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
    expect(document.body.textContent).toContain("CB-26-001 carries the whole 1,000 t·km because its run PR-26-001 was the first completed run to draw from FS-26-001, on Feb 4, 2026.");
    const table = screen.getByText("Where the 10,000 kg went").closest("table")!;
    expect(within(table).getByText("Drawn by PR-26-001, carries the transport")).toBeTruthy();
    expect(within(table).getByText("Drawn by PR-26-004")).toBeTruthy();
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
  it("shows server-owned Removal shares and their unassigned remainder", () => {
    show({ removalId: REMOVAL_1 }, "?allocation=table");
    // Half the delivery belongs to this Removal despite membership in both batches.
    const delivery = screen.getAllByText("DL-26-001")[0].closest("tr")!;
    expect(within(delivery).getAllByText("180 t·km").length).toBeGreaterThan(0);
    expect(within(delivery).getAllByText("50%").length).toBeGreaterThan(0);
    // A run on a batch no Removal lists, and an untouched delivery, are not allocated to RM-26-001.
    expect(screen.getAllByText("not yet allocated").length).toBeGreaterThan(0);
  });
});

describe("EmissionAllocationSection, hint A on a Removal", () => {
  it("labels the marker as batch usage and opens the breakdown", () => {
    show({ removalId: REMOVAL_1 }, "?allocation=table");
    expect(screen.getAllByText("Batches used 5,000 of 10,000 kg").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "About FS-26-001 transport" })[0]);
    expect(document.body.textContent).toContain("RM-26-001 carries the whole 1,000 t·km through CB-26-001");
    expect(screen.getByText("Where the 10,000 kg went")).toBeTruthy();
  });
});

describe("EmissionAllocationSection, a second Removal that only counts", () => {
  const SECOND = "removal-2";
  beforeEach(() => {
    const data = allocationFixture();
    data.removals.push({ id: SECOND, code: "RM-26-002", status: "draft", creditBatchIds: [BATCH_B] });
    state.data = data;
  });

  it("shows Counted on RM-26-001 and the batch usage marker in the Table", () => {
    show({ removalId: SECOND }, "?allocation=table");
    expect(screen.getAllByText("Counted on").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RM-26-001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Batches used 3,000 of 10,000 kg").length).toBeGreaterThan(0);
  });

  it("shows the same in Flow, from the Removal parts", () => {
    show({ removalId: SECOND });
    const row = document.querySelector('[data-share-row="feedstock"]') as HTMLElement;
    expect(within(row).getByText("1 counted on RM-26-001")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /^Feedstock transport:/ }));
    expect(within(row).getByText("Batches used 3,000 of 10,000 kg")).toBeTruthy();
  });
});

describe("EmissionAllocationSection, Flow on a Removal", () => {
  it("reads Removal parts: half of the split delivery is this Removal's, the rest not yet allocated", () => {
    show({ removalId: REMOVAL_1 });
    expect(screen.getByRole("button", { name: (name) => name.startsWith("Biochar delivery transport: 180 t·km \u00b7 50%") })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Biochar delivery transport:/ }));
    const row = document.querySelector('[data-share-row="delivery"]') as HTMLElement;
    expect(within(row).getByText("not yet allocated")).toBeTruthy();
    expect(within(row).getAllByText("RM-26-001").length).toBeGreaterThan(0);
  });
});

describe("EmissionAllocationSection, a manual entry without a name", () => {
  it("reads Manual entry, never the component ID", () => {
    const data = allocationFixture();
    const entry = data.records.find((record) => record.id === "me-1")!;
    entry.detail = { kind: "manual", creditBatchId: BATCH_A, componentId: "loader-diesel", componentName: "loader-diesel", kindOfEntry: "value", omittedInputKeys: [] };
    state.data = data;
    show({ creditBatchId: BATCH_A }, "?allocation=table");
    expect(screen.getAllByText("Manual entry").length).toBeGreaterThan(0);
    expect(screen.queryByText("loader-diesel")).toBeNull();
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
