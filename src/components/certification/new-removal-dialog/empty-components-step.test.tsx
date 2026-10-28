// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "Africa/Dar_es_Salaam", hint: "" }) }));
import type { RemovalEmptyComponents } from "@/lib/certification/empty-components-state";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  undo: vi.fn(),
  error: null as Error | null,
  errorBatchId: null as string | null,
  busy: false,
  pendingBatchId: null as string | null,
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
vi.mock("@/components/ui/notice", () => ({ Notice: ({ children, action }: { children: ReactNode; action?: ReactNode }) => <div role="alert">{children}{action}</div> }));

import { EmptyComponentsStep } from "./empty-components-step";

const REMOVAL_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";

function batch(overrides: { lines?: string[]; zeros?: Array<{ name: string; note?: string }> }) {
  return {
    creditBatchId: BATCH_ID,
    code: "CB-26-001",
    lines: (overrides.lines ?? []).map((name, index) => ({ componentId: `c-${name}`, displayName: name, group: "G", description: null, position: index })),
    zeros: (overrides.zeros ?? []).map((zero) => ({
      id: `z-${zero.name}`, componentId: `c-${zero.name}`, displayName: zero.name,
      position: ["A", "B", "C"].indexOf(zero.name), note: zero.note ?? null, authorId: "user-1", createdAt: new Date("2026-10-20T10:00:00Z"),
    })),
  };
}

function actions() {
  return {
    busy: mocks.busy,
    pendingBatchId: mocks.pendingBatchId,
    error: mocks.error,
    errorBatchId: mocks.errorBatchId,
    recordZeros: mocks.record,
    undoZeros: mocks.undo,
  };
}

function renderStep(data: unknown, focusRequest: { batchId: string; nonce: number } | null = null) {
  return render(
    <EmptyComponentsStep
      removalId={REMOVAL_ID}
      facilityId="facility-1"
      data={data as RemovalEmptyComponents}
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
      batchDates={{ [BATCH_ID]: { startDate: "2026-09-01", endDate: "2026-09-30" } }}
      actions={actions()}
      focusRequest={focusRequest}
    />,
  );
}

afterEach(cleanup);
beforeEach(() => {
  mocks.record.mockReset();
  mocks.undo.mockReset();
  mocks.error = null;
  mocks.errorBatchId = null;
  mocks.busy = false;
  mocks.pendingBatchId = null;
});

describe("EmptyComponentsStep", () => {
  it("lists a batch's empty components with Add entry opening its Emissions page in a new tab", () => {
    renderStep({ removalVersion: 5, editable: true, batches: [batch({ lines: ["Staff travel local", "Sampling consumables"] })] });

    expect(screen.getByText("Staff travel local")).toBeTruthy();
    expect(screen.getByText("2 components not recorded")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Add entry for Staff travel local" });
    expect(link.getAttribute("href")).toBe(`/credit-batches/${BATCH_ID}?facility=facility-1&tab=emissions`);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("records every empty component as zero with the note and the version the operator saw", () => {
    renderStep({ removalVersion: 5, editable: true, batches: [batch({ lines: ["A", "B"] })] });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "No travel." } });
    fireEvent.click(screen.getByRole("button", { name: "Record 2 components as zero" }));

    expect(mocks.record).toHaveBeenCalledWith({
      removalId: REMOVAL_ID,
      creditBatchId: BATCH_ID,
      expectedRemovalVersion: 5,
      componentIds: ["c-A", "c-B"],
      note: "No travel.",
    });
  });

  it("uses the singular for one component", () => {
    renderStep({ removalVersion: 1, editable: true, batches: [batch({ lines: ["A"] })] });
    expect(screen.getByRole("button", { name: "Record 1 component as zero" })).toBeTruthy();
  });

  it("shows confirmed components once as recorded zero, with the note, and undoes them for the batch", () => {
    renderStep({ removalVersion: 6, editable: true, batches: [batch({ zeros: [{ name: "A", note: "No travel." }, { name: "B" }] })] });

    // The header says it; the rows repeat it only when open and recorded rows differ.
    expect(screen.getByText("2 components recorded as zero")).toBeTruthy();
    expect(screen.queryByText("Recorded zero")).toBeNull();
    expect(screen.getByText("No travel.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Record \d+ component/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(mocks.undo).toHaveBeenCalledWith({
      removalId: REMOVAL_ID, creditBatchId: BATCH_ID, expectedRemovalVersion: 6,
    });
  });

  it("lists recorded components in template order, not the order they were written", () => {
    renderStep({ removalVersion: 1, editable: true, batches: [batch({ zeros: [{ name: "C" }, { name: "A" }, { name: "B" }] })] });
    const rows = screen.getByRole("list", { name: "Components in CB-26-001" }).querySelectorAll("li");
    expect([...rows].map((row) => row.textContent?.replace("Recorded zero", ""))).toEqual(["A", "B", "C"]);
  });

  it("labels each row when open and recorded components are mixed", () => {
    renderStep({ removalVersion: 1, editable: true, batches: [batch({ lines: ["A"], zeros: [{ name: "B" }] })] });
    expect(screen.getAllByText("Recorded zero")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Add entry for A" })).toBeTruthy();
  });

  it("offers no Record or Undo where the Removal can no longer take zeros", () => {
    renderStep({ removalVersion: 1, editable: false, batches: [batch({ lines: ["A"] }), { ...batch({ zeros: [{ name: "B" }] }), creditBatchId: "other", code: "CB-2" }] });
    expect(screen.queryByRole("button", { name: /Record \d+ component/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("disables every card's actions while a write or its refresh is pending", () => {
    mocks.busy = true;
    mocks.pendingBatchId = BATCH_ID;
    renderStep({ removalVersion: 1, editable: true, batches: [batch({ lines: ["A"] })] });
    expect((screen.getByRole("button", { name: "Record 1 component as zero" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("puts the cursor in the note of the card a refused Continue names, once", () => {
    const view = renderStep({ removalVersion: 1, editable: true, batches: [batch({ lines: ["A"] })] }, { batchId: BATCH_ID, nonce: 1 });
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    (document.activeElement as HTMLElement).blur();
    view.rerender(
      <EmptyComponentsStep
        removalId={REMOVAL_ID}
        facilityId="facility-1"
        data={{ removalVersion: 1, editable: true, batches: [batch({ lines: ["A"] })] } as unknown as RemovalEmptyComponents}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        batchDates={{}}
        actions={actions()}
        focusRequest={{ batchId: BATCH_ID, nonce: 1 }}
      />,
    );
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));
  });

  it("says a batch has nothing empty once, in its header", () => {
    renderStep({ removalVersion: 1, editable: true, batches: [batch({})] });
    expect(screen.getAllByText(/empty components/i).filter((node) => node.tagName !== "H3")).toHaveLength(1);
    expect(screen.queryByText(/Every component has/)).toBeNull();
  });

  it("announces the state in a live region that stays mounted", () => {
    renderStep({ removalVersion: 1, editable: true, batches: [batch({ lines: ["A"] })] });
    expect(screen.getByRole("status").textContent).toContain("1 component not recorded");
  });

  it("shows why a write was refused on the card it ran on", () => {
    mocks.error = new Error("This record changed since you opened it.");
    mocks.errorBatchId = BATCH_ID;
    renderStep({ removalVersion: 1, editable: true, batches: [batch({ lines: ["A"] })] });
    expect(screen.getByRole("alert").textContent).toContain("This record changed since you opened it.");
  });
});

it("shows the recorded time on the facility clock", () => {
  renderStep({ batches: [batch({ zeros: [{ name: "A" }] })] });
  expect(screen.getByText("Recorded Oct 20, 2026, 13:00")).toBeDefined();
});
