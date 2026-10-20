// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalEmptyComponents } from "@/hooks/use-removal-empty-components";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  undo: vi.fn(),
  recordError: null as Error | null,
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
vi.mock("@/hooks/use-removal-empty-components", () => ({
  useRecordEmissionZeros: () => ({ mutate: mocks.record, isPending: false, error: mocks.recordError }),
  useUndoEmissionZeros: () => ({ mutate: mocks.undo, isPending: false, error: null }),
}));

import { EmptyComponentsStep } from "./empty-components-step";

const REMOVAL_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";

function batch(overrides: { lines?: string[]; zeros?: Array<{ name: string; note?: string }> }) {
  return {
    creditBatchId: BATCH_ID,
    code: "CB-26-001",
    lines: (overrides.lines ?? []).map((name) => ({ componentId: `c-${name}`, displayName: name, group: "G", description: null })),
    zeros: (overrides.zeros ?? []).map((zero) => ({
      id: `z-${zero.name}`, componentId: `c-${zero.name}`, displayName: zero.name,
      note: zero.note ?? null, authorId: "user-1", createdAt: new Date("2026-10-20T10:00:00Z"),
    })),
  };
}

function renderStep(data: unknown) {
  return render(
    <EmptyComponentsStep
      removalId={REMOVAL_ID}
      facilityId="facility-1"
      data={data as RemovalEmptyComponents}
      isLoading={false}
      isError={false}
      batchDates={{ [BATCH_ID]: { startDate: "2026-09-01", endDate: "2026-09-30" } }}
    />,
  );
}

afterEach(cleanup);
beforeEach(() => {
  mocks.record.mockReset();
  mocks.undo.mockReset();
  mocks.recordError = null;
});

describe("EmptyComponentsStep", () => {
  it("lists a batch's empty components with Add entry opening its Emissions page in a new tab", () => {
    renderStep({ removalVersion: 5, batches: [batch({ lines: ["Staff travel local", "Sampling consumables"] })] });

    expect(screen.getByText("Staff travel local")).toBeTruthy();
    expect(screen.getByText("2 components not recorded")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Add entry for Staff travel local" });
    expect(link.getAttribute("href")).toBe(`/emissions/${BATCH_ID}`);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("records every empty component as zero with the note and the version the operator saw", () => {
    renderStep({ removalVersion: 5, batches: [batch({ lines: ["A", "B"] })] });

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
    renderStep({ removalVersion: 1, batches: [batch({ lines: ["A"] })] });
    expect(screen.getByRole("button", { name: "Record 1 component as zero" })).toBeTruthy();
  });

  it("shows confirmed components as Recorded zero with the note and undoes them for the batch", () => {
    renderStep({ removalVersion: 6, batches: [batch({ zeros: [{ name: "A", note: "No travel." }, { name: "B" }] })] });

    expect(screen.getAllByText("Recorded zero")).toHaveLength(2);
    expect(screen.getByText("2 components recorded as zero")).toBeTruthy();
    expect(screen.getByText("No travel.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Record \d+ component/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(mocks.undo).toHaveBeenCalledWith({
      removalId: REMOVAL_ID, creditBatchId: BATCH_ID, expectedRemovalVersion: 6,
    });
  });

  it("says so when a batch has nothing empty", () => {
    renderStep({ removalVersion: 1, batches: [batch({})] });
    expect(screen.getByText("No empty components")).toBeTruthy();
  });

  it("announces the state in a live region that stays mounted", () => {
    renderStep({ removalVersion: 1, batches: [batch({ lines: ["A"] })] });
    expect(screen.getByRole("status").textContent).toContain("1 component not recorded");
  });

  it("shows why a write was refused next to the action", () => {
    mocks.recordError = new Error("This record changed since you opened it.");
    renderStep({ removalVersion: 1, batches: [batch({ lines: ["A"] })] });
    expect(screen.getByRole("alert").textContent).toContain("This record changed since you opened it.");
  });
});
