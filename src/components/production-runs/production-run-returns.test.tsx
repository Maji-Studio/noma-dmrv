// @vitest-environment jsdom
/**
 * Leftover material on a Failed run (#439): the section shows for Failed runs
 * only, a blocker replaces the action with its reason, the return form checks
 * its fields and shows the server's refusal at the wet mass field, and a
 * correction starts from the saved values and needs a reason.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useController, type Control, type FieldValues } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionRunReturnRow } from "@/data-access/production-run-returns/view";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";
import { RETURN_OVER_CAP_MESSAGE } from "@/lib/production-run-returns/mass";

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const BIN_ID = "00000000-0000-4000-8000-000000000002";
const FACILITY_ID = "00000000-0000-4000-8000-000000000003";
const TYPE_ID = "00000000-0000-4000-8000-000000000004";
const RETURN_ID = "00000000-0000-4000-8000-000000000005";

const mocks = vi.hoisted(() => ({
  record: { mutateAsync: vi.fn(), isPending: false },
  correct: { mutateAsync: vi.fn(), isPending: false },
  rows: [] as unknown[],
  eligibility: {} as Record<string, unknown>,
  balance: null as unknown,
  balanceError: false,
}));

vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => children, InfoHint: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: undefined }) }));
vi.mock("@/hooks/use-production-run-returns", () => ({
  useRecordProductionRunReturn: () => mocks.record,
  useCorrectProductionRunReturn: () => mocks.correct,
  useProductionRunReturns: () => ({ data: mocks.rows, isLoading: false, error: null }),
  useProductionRunReturnEligibility: () => ({ data: mocks.eligibility, isLoading: false, error: null }),
  useProductionRunMaterialBalance: () => ({ data: mocks.balance, isLoading: false, error: mocks.balanceError ? new Error("x") : null }),
}));
// The bin picker is its own component; here it is one field that holds the chosen id.
vi.mock("@/components/forms/entity-select/form-entity-select", () => ({
  FormEntitySelect: ({ control, name }: { control: Control<FieldValues>; name: string }) => {
    const { field } = useController({ control, name });
    return <input aria-label="Destination bin" value={field.value ?? ""} onChange={(event) => field.onChange(event.target.value)} />;
  },
}));

import { ProductionRunReturnForm } from "./production-run-return-form";
import { ProductionRunReturnReverseDialog } from "./production-run-return-reverse-dialog";
import { ProductionRunReturns } from "./production-run-returns";
import { productionRunSheetSections } from "./production-run-read-sections";

const savedReturn: ProductionRunReturnRow = {
  id: RETURN_ID, storageLocationId: BIN_ID, destinationName: "Return bin", destinationCode: "BIN-R", wetMassKg: 50, moisturePercent: 30, dryMassKg: 35,
  occurredAt: "2026-11-20T12:00:00.000Z", recordedAt: "2026-11-20T12:05:00.000Z", actorName: "Asha", reason: "Left in the reactor",
  state: "active", reversal: null, replacementId: null, replacesId: null,
};
const eligible = { eligible: true, blocker: null, code: null, consumedDryKg: 140, returnedDryKg: 35, remainingDryKg: 105, returnedFeedstockTypeId: TYPE_ID };

beforeEach(() => {
  mocks.record.mutateAsync.mockReset();
  mocks.correct.mutateAsync.mockReset();
  mocks.rows = [];
  mocks.balanceError = false;
  mocks.eligibility = eligible;
  mocks.balance = { balance: { runId: RUN_ID, consumedDryKg: 140, usableOutputDryKg: 0, activeReturnedDryKg: 0, conversionLossDryKg: 140 } };
});
afterEach(cleanup);

const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: string) => act(async () => { fireEvent.click(screen.getByRole("button", { name })); });

describe("Leftover material section", () => {
  const run = (status: string) => ({ id: RUN_ID, facilityId: FACILITY_ID, status, feedstockDraws: [], totalFeedstockWetMassKg: 200 }) as unknown as ProductionRunWithRelations;
  const titles = (status: string) => productionRunSheetSections(run(status), []).map((section) => section.title);

  it("is part of a Failed run's view and of no other status", () => {
    expect(titles("failed")).toContain("Leftover material");
    for (const status of ["running", "complete", "cancelled"]) expect(titles(status)).not.toContain("Leftover material");
  });

  it("shows the figures, the returns and the action on an eligible run", () => {
    mocks.rows = [savedReturn];
    render(<ProductionRunReturns runId={RUN_ID} facilityId={FACILITY_ID} feedstockWetMassKg={200} />);
    expect(screen.getByText("Fed into the run")).toBeTruthy();
    expect(screen.queryByText("Can still return")).toBeNull();
    expect(screen.getByRole("link", { name: "Return bin" }).getAttribute("href")).toContain(BIN_ID);
    expect(screen.getByText(/50 kg wet mass/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Return to storage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Correct" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reverse" })).toBeTruthy();
  });

  it("shows the conversion loss and storage-precision masses for a partial return", () => {
    mocks.rows = [{ ...savedReturn, wetMassKg: 0.001, dryMassKg: 0.0007 }];
    mocks.balance = { balance: { runId: RUN_ID, consumedDryKg: 140, usableOutputDryKg: 60, activeReturnedDryKg: 35, conversionLossDryKg: 45 } };
    render(<ProductionRunReturns runId={RUN_ID} facilityId={FACILITY_ID} feedstockWetMassKg={200} />);
    expect(screen.getByText("Conversion loss")).toBeTruthy();
    expect(screen.getByText("45 kg")).toBeTruthy();
    expect(screen.getByText(/0\.001 kg wet mass/)).toBeTruthy();
  });

  it("says nothing returned with the empty state, and shows an error when the balance cannot load", () => {
    mocks.balanceError = true;
    mocks.balance = undefined;
    render(<ProductionRunReturns runId={RUN_ID} facilityId={FACILITY_ID} feedstockWetMassKg={200} />);
    expect(screen.getByText("Nothing has gone back to storage yet.")).toBeTruthy();
    expect(screen.getByText(/material balance could not be loaded/)).toBeTruthy();
  });

  it("shows no allowance figure at rest when the run is blocked", () => {
    mocks.eligibility = { ...eligible, eligible: false, code: "ineligible", blocker: "This run is in use.", remainingDryKg: 105 };
    render(<ProductionRunReturns runId={RUN_ID} facilityId={FACILITY_ID} feedstockWetMassKg={200} />);
    expect(screen.getByText("Conversion loss")).toBeTruthy();
    expect(screen.queryByText("Can still return")).toBeNull();
  });

  it("keeps only the next step for a fully returned run", () => {
    mocks.eligibility = { ...eligible, eligible: false, code: "ineligible", remainingDryKg: 0, blocker: "All consumed dry material has been returned. Correct an existing return to change its measurements." };
    render(<ProductionRunReturns runId={RUN_ID} facilityId={FACILITY_ID} feedstockWetMassKg={200} />);
    expect(screen.queryByText(/All consumed dry material/)).toBeNull();
    expect(screen.getByText("Correct an existing return to change its measurements.")).toBeTruthy();
  });

  it("states the blocker as one line and offers no return action", () => {
    const blocker = "Returns from runs with mixed feedstock types are not supported.";
    mocks.eligibility = { eligible: false, blocker, code: "ineligible", consumedDryKg: null, returnedDryKg: null, remainingDryKg: null, returnedFeedstockTypeId: null };
    mocks.balance = { balance: null };
    render(<ProductionRunReturns runId={RUN_ID} facilityId={FACILITY_ID} feedstockWetMassKg={200} />);
    expect(screen.getByText(blocker)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Return to storage" })).toBeNull();
  });

  it("shows the first three returns, then Show all N", () => {
    mocks.rows = [1, 2, 3, 4, 5].map((n) => ({ ...savedReturn, id: `r${n}`, destinationName: `Bin ${n}` }));
    render(<ProductionRunReturns runId={RUN_ID} facilityId={FACILITY_ID} feedstockWetMassKg={200} />);
    expect(screen.queryByText("Bin 4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 5" }));
    expect(screen.getByText("Bin 5")).toBeTruthy();
  });

  it("keeps the actions off a read-only view", () => {
    mocks.rows = [savedReturn];
    render(<ProductionRunReturns runId={RUN_ID} facilityId={FACILITY_ID} feedstockWetMassKg={200} readOnly />);
    expect(screen.queryByRole("button", { name: "Return to storage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
  });
});

describe("Return to storage form", () => {
  const form = (props: Partial<React.ComponentProps<typeof ProductionRunReturnForm>> = {}) => render(
    <ProductionRunReturnForm runId={RUN_ID} facilityId={FACILITY_ID} feedstockTypeId={TYPE_ID} remainingDryKg={100} onCancel={vi.fn()} onSaved={vi.fn()} {...props} />,
  );

  it("requires the moisture and a wet mass above zero", async () => {
    form();
    fill("Destination bin", BIN_ID);
    fill(/Returned wet mass/, "0");
    fill(/^Reason/, "Left in the reactor");
    await submit("Return to storage");
    expect(await screen.findByText("Wet mass must be greater than 0.")).toBeTruthy();
    expect(screen.getByText("Enter measured moisture.")).toBeTruthy();
    expect(mocks.record.mutateAsync).not.toHaveBeenCalled();
  });

  it("refuses a return whose dry mass is over what can still return", async () => {
    form();
    fill("Destination bin", BIN_ID);
    fill(/Returned wet mass/, "200");
    fill(/Returned moisture/, "10");
    fill(/^Reason/, "Left in the reactor");
    await submit("Return to storage");
    expect(await screen.findByText(RETURN_OVER_CAP_MESSAGE)).toBeTruthy();
    expect(mocks.record.mutateAsync).not.toHaveBeenCalled();
  });

  it("names the gap in the after block: over the allowance, then missing moisture", async () => {
    form();
    expect(screen.getByText("Enter a mass")).toBeTruthy();
    fill(/Returned wet mass/, "200");
    expect(screen.getByText("Enter the moisture")).toBeTruthy();
    fill(/Returned moisture/, "10");
    expect(screen.getByText("Over by 80 kg")).toBeTruthy();
  });

  it("shows a sub-kilogram excess at storage precision", () => {
    form();
    fill(/Returned wet mass/, "100.001");
    fill(/Returned moisture/, "0");
    expect(screen.getByText("Over by 0.001 kg")).toBeTruthy();
  });

  it("saves a valid return with a request key", async () => {
    mocks.record.mutateAsync.mockResolvedValue({});
    const onSaved = vi.fn();
    form({ onSaved });
    fill("Destination bin", BIN_ID);
    fill(/Returned wet mass/, "50");
    fill(/Returned moisture/, "30");
    fill(/^Reason/, "Left in the reactor");
    await submit("Return to storage");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocks.record.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      sourceProductionRunId: RUN_ID, storageLocationId: BIN_ID, wetMassKg: 50, moisturePercent: 30, reason: "Left in the reactor", idempotencyKey: expect.any(String),
    }));
  });

  it("shows the server's over-allowance message at the wet mass field", async () => {
    mocks.record.mutateAsync.mockRejectedValue(new Error(RETURN_OVER_CAP_MESSAGE));
    form();
    fill("Destination bin", BIN_ID);
    fill(/Returned wet mass/, "100");
    fill(/Returned moisture/, "0");
    fill(/^Reason/, "Left in the reactor");
    await submit("Return to storage");
    expect(await screen.findByText(RETURN_OVER_CAP_MESSAGE)).toBeTruthy();
  });

  it("starts a correction from the saved values and sends a reversal with its replacement", async () => {
    mocks.correct.mutateAsync.mockResolvedValue({});
    const onSaved = vi.fn();
    form({ correction: savedReturn, onSaved });
    expect((screen.getByLabelText(/Returned wet mass/) as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText(/Returned moisture/) as HTMLInputElement).value).toBe("30");
    await submit("Save correction");
    expect(await screen.findByText(/Enter a reason/)).toBeTruthy();
    expect(mocks.correct.mutateAsync).not.toHaveBeenCalled();
    fill(/Why corrected/, "Scale misread");
    fill(/Returned wet mass/, "45");
    await submit("Save correction");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocks.correct.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      sourceProductionRunId: RUN_ID, storageLocationId: BIN_ID, correctsMovementId: RETURN_ID, reason: "Scale misread",
      replacement: expect.objectContaining({ wetMassKg: 45, moisturePercent: 30, storageLocationId: BIN_ID }),
    }));
  });
});

describe("Reverse return dialog", () => {
  it("needs a reason, then sends a reversal with no replacement", async () => {
    mocks.correct.mutateAsync.mockResolvedValue({});
    const onClose = vi.fn();
    render(<ProductionRunReturnReverseDialog runId={RUN_ID} entry={savedReturn} timeZone="UTC" onClose={onClose} />);
    await submit("Reverse return");
    expect(await screen.findByText("Enter why you reverse this entry.")).toBeTruthy();
    expect(mocks.correct.mutateAsync).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Recorded twice" } });
    await submit("Reverse return");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.correct.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      correctsMovementId: RETURN_ID, storageLocationId: BIN_ID, reason: "Recorded twice", replacement: null,
    }));
  });
});
