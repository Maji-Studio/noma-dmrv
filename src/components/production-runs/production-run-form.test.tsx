// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";
import { FormDialogContext, type DialogFormState } from "@/components/ui/form-dialog-context";

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: "11111111-1111-4111-8111-111111111111",
    facilities: [{ id: "11111111-1111-4111-8111-111111111111", timezone: "UTC" }],
  }),
}));
vi.mock("@/hooks/use-entities", () => ({ useEntityById: () => ({ data: undefined }) }));
const pickers = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/components/forms/entity-select", () => ({
  EntitySelect: (props: Record<string, unknown>) => { pickers.push(props); return null; },
  StorageLocationQuickAddDialog: () => null,
  useQuickAddDialog: () => ({ isOpen: false, open: vi.fn(), close: vi.fn() }),
}));
vi.mock("./production-run-feedstock-draw-row", () => ({ ProductionRunFeedstockDrawRow: () => null }));
vi.mock("./production-run-mix-bin-notice", () => ({ ProductionRunMixBinNotice: () => null }));
// The footer line has its own tests; here it only marks its place in the footer.
const previewProps: Array<{ clearEndTime: boolean }> = [];
vi.mock("./production-run-credit-batch-preview", () => ({
  ProductionRunCreditBatchPreview: (props: { clearEndTime: boolean }) => {
    previewProps.push(props);
    return <p data-testid="credit-batch-preview" />;
  },
}));
vi.mock("./production-readings-field", () => ({ ProductionReadingsField: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));

import { ProductionRunForm } from "./production-run-form";
import { OPEN_LOCK } from "../../../tests/helpers/record-lock-mocks";

const savedRun = {
  id: "55555555-5555-4555-8555-555555555555",
  version: 2,
  facilityId: "11111111-1111-4111-8111-111111111111",
  reactorId: "22222222-2222-4222-8222-222222222222",
  startTime: new Date("2026-07-15T08:00:00Z"),
  endTime: new Date("2026-07-15T12:00:00Z"),
  feedstockDraws: [{ storageLocationId: "33333333-3333-4333-8333-333333333333", wetMassKg: 100 }],
  feedstockMoisturePercent: 20,
  biocharOutputKg: 10,
  biocharMoisturePercent: 5,
  biocharStorageLocationId: "44444444-4444-4444-8444-444444444444",
} as unknown as ProductionRunWithRelations;

afterEach(() => { cleanup(); pickers.length = 0; previewProps.length = 0; });

describe("ProductionRunForm reactor picker", () => {
  it("links to creating a reactor at the run's facility", () => {
    render(<ProductionRunForm onSubmit={vi.fn()} />);
    const reactor = pickers.findLast((props) => props.entityType === "reactor");
    expect(reactor).toMatchObject({
      allowCreate: true,
      createHref: "/reactors?facility=11111111-1111-4111-8111-111111111111&create=true",
      emptyHint: { message: "This facility has no reactors yet." },
    });
  });
});

describe("ProductionRunForm unsaved changes", () => {
  const REACTOR_ID = "22222222-2222-4222-8222-222222222222";
  const dirtyStates = () => {
    const states: boolean[] = [];
    const actions = {
      report: (_id: object, state: DialogFormState | null) => { if (state) states.push(state.dirty); },
      cancel: vi.fn(),
      markSaved: vi.fn(),
    };
    render(<FormDialogContext.Provider value={actions}><ProductionRunForm onSubmit={vi.fn()} onCancel={vi.fn()} /></FormDialogContext.Provider>);
    return states;
  };
  const reactor = () => pickers.findLast((props) => props.entityType === "reactor") as {
    value: string; onChange: (id: string) => void; onAutoSelect?: (id: string) => void;
  };

  it("stays clean when the facility's only reactor is picked for the operator", async () => {
    const states = dirtyStates();
    // What the real select does with autoSelectSingle and one option.
    act(() => { (reactor().onAutoSelect ?? reactor().onChange)(REACTOR_ID); });
    await waitFor(() => expect(reactor().value).toBe(REACTOR_ID));
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((dirty) => !dirty)).toBe(true);
  });

  it("turns dirty once the operator picks a reactor", async () => {
    const states = dirtyStates();
    act(() => { reactor().onChange(REACTOR_ID); });
    await waitFor(() => expect(states.at(-1)).toBe(true));
  });
});

describe("ProductionRunForm credit batch line", () => {
  it("puts the credit batch line in the footer, directly before Save", () => {
    render(<ProductionRunForm onSubmit={vi.fn()} />);
    const line = screen.getByTestId("credit-batch-preview");
    const save = screen.getByRole("button", { name: "Create production run" });
    // Outside the <form>, in the footer, and before the buttons.
    expect(line.closest("form")).toBeNull();
    expect(line.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(save.getAttribute("form")).toBe(document.querySelector("form")!.id);
  });
});

describe("ProductionRunForm reopening", () => {
  it.each(["complete", "failed"] as const)("reopens a saved %s run without touching its end fields", async (status) => {
    const onSubmit = vi.fn();
    render(<ProductionRunForm productionRun={{ ...savedRun, status }} onSubmit={onSubmit} lock={OPEN_LOCK} />);
    const endDate = document.querySelector<HTMLInputElement>('input[name="endDate"]')!;
    const endTime = document.querySelector<HTMLInputElement>('input[name="endTime"]')!;
    expect(endDate.value).toBe("2026-07-15");
    expect(endTime.value).toBe("12:00");

    expect(previewProps.at(-1)?.clearEndTime).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Running" }));
    // The credit batch line ignores the end time the save is about to clear.
    expect(previewProps.at(-1)?.clearEndTime).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Update production run" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      status: "running", endTime: null, expectedVersion: savedRun.version,
    }));
    expect(endDate.value).toBe("2026-07-15");
    expect(endTime.value).toBe("12:00");
  });

  it("keeps the end-time field error for an already Running run", async () => {
    const onSubmit = vi.fn();
    render(<ProductionRunForm productionRun={{ ...savedRun, status: "running", endTime: null }} onSubmit={onSubmit} lock={OPEN_LOCK} />);
    fireEvent.change(document.querySelector('input[name="endTime"]')!, { target: { value: "12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Update production run" }));
    await screen.findByText("Choose Complete or clear the end time for a Running run.");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
