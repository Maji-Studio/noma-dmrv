// @vitest-environment jsdom
import type { ReactNode } from "react";
import { useController, type Control } from "react-hook-form";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditBatch } from "@/db/schema/credits";
import { CreditBatchForm } from "./credit-batch-form";

const mocks = vi.hoisted(() => ({ certifierSummary: vi.fn(), methodBEligibility: vi.fn(), showFacilitySelect: false }));

const ISOMETRIC_FACILITY_ID = "00000000-0000-4000-8000-000000000002";
const UNMAPPED_FACILITY_ID = "00000000-0000-4000-8000-000000000004";
const MONTH_REFUSAL = "A credit batch may span at most one month (one calendar month; noma rule).";

function FacilitySelect({ control }: { control: Control<{ facilityId: string }> }) {
  const { field } = useController({ control, name: "facilityId" });
  return (
    <select aria-label="Facility" {...field}>
      <option value={ISOMETRIC_FACILITY_ID}>Isometric facility</option>
      <option value={UNMAPPED_FACILITY_ID}>Facility without a certifier</option>
    </select>
  );
}

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "facility" }) }));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useFacilityCertifierSummary: mocks.certifierSummary,
}));
vi.mock("@/hooks/use-feedstock-types", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-feedstock-types")>(),
  useFeedstockTypeList: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-production-processes", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-production-processes")>(),
  useMethodBEligibility: mocks.methodBEligibility,
}));
vi.mock("@/hooks/use-credit-batches", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-credit-batches")>(),
  useCreditBatchProductionRunOptions: () => ({ data: [], isSuccess: true }),
}));
vi.mock("@/components/forms", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms")>(),
  // Expose the form's facility field without coupling this test to the entity picker.
  FormEntitySelect: ({ control }: { control: Control<{ facilityId: string }> }) =>
    mocks.showFacilitySelect ? <FacilitySelect control={control} /> : null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);
beforeEach(() => {
  mocks.methodBEligibility.mockClear();
  mocks.methodBEligibility.mockReturnValue({ data: undefined });
  mocks.showFacilitySelect = false;
  mocks.certifierSummary.mockReturnValue({ data: undefined });
});

describe("CreditBatchForm required dates", () => {
  it("passes the watched start date to the Method-B preview and clears it when empty", async () => {
    const { container } = render(<CreditBatchForm onSubmit={vi.fn()} />);
    const startDate = container.querySelector('input[name="startDate"]')!;
    fireEvent.change(startDate, { target: { value: "2025-03-01" } });
    await waitFor(() => expect(mocks.methodBEligibility).toHaveBeenLastCalledWith("facility", "", false, new Date("2025-03-01")));
    fireEvent.change(startDate, { target: { value: "" } });
    await waitFor(() => expect(mocks.methodBEligibility).toHaveBeenLastCalledWith("facility", "", false, undefined));
  });

  it.each(["create", "edit"])("marks both date labels required in %s mode", (mode) => {
    const creditBatch = mode === "edit" ? {
      id: "batch", facilityId: "facility", startDate: "2026-09-01", endDate: "2026-09-30",
      feedstockTypeId: "feedstock", sampling: "sampled",
    } as CreditBatch : undefined;
    const { container } = render(<CreditBatchForm creditBatch={creditBatch} onSubmit={vi.fn()} />);
    for (const field of ["startDate", "endDate"]) {
      const label = container.querySelector(`label[for="${field}"]`)!;
      expect(label.textContent).toContain("Required");
      expect(label.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
    }
  });
});

describe("CreditBatchForm certifier period policy", () => {
  const creditBatch = {
    id: "00000000-0000-4000-8000-000000000001",
    facilityId: "00000000-0000-4000-8000-000000000002",
    feedstockTypeId: "00000000-0000-4000-8000-000000000003",
    startDate: "2026-01-01",
    endDate: "2026-04-30",
    sampling: "sampled",
    certifier: null,
    productionRunIds: [],
  } as unknown as CreditBatch;

  it("submits a multi-month period for a facility without a certifier", async () => {
    mocks.certifierSummary.mockReturnValue({ data: { mapping: null } });
    const onSubmit = vi.fn();
    const { container } = render(<CreditBatchForm creditBatch={creditBatch} onSubmit={onSubmit} />);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-04-30"),
    })));
  });

  it("refuses the same period for an Isometric facility", async () => {
    mocks.certifierSummary.mockReturnValue({ data: { mapping: { provider: "isometric" } } });
    const onSubmit = vi.fn();
    const { container } = render(<CreditBatchForm creditBatch={creditBatch} onSubmit={onSubmit} />);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByText("A credit batch may span at most one month (one calendar month; noma rule).")).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("lifts the month refusal when switching to an unmapped facility and restores it on switching back", async () => {
    mocks.showFacilitySelect = true;
    mocks.certifierSummary.mockImplementation((facilityId: string) => ({
      data: { mapping: facilityId === ISOMETRIC_FACILITY_ID ? { provider: "isometric" } : null },
    }));
    const onSubmit = vi.fn();
    const { container } = render(<CreditBatchForm creditBatch={creditBatch} onSubmit={onSubmit} />);
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    await screen.findByText(MONTH_REFUSAL);

    fireEvent.change(screen.getByRole("combobox", { name: "Facility" }), {
      target: { value: UNMAPPED_FACILITY_ID },
    });
    await waitFor(() => expect(screen.queryByText(MONTH_REFUSAL)).toBeNull());
    expect(mocks.certifierSummary).toHaveBeenLastCalledWith(UNMAPPED_FACILITY_ID, true);
    fireEvent.submit(form);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ facilityId: UNMAPPED_FACILITY_ID })));

    onSubmit.mockClear();
    fireEvent.change(screen.getByRole("combobox", { name: "Facility" }), {
      target: { value: ISOMETRIC_FACILITY_ID },
    });
    await screen.findByText(MONTH_REFUSAL);
    await act(async () => { fireEvent.submit(form); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("revalidates when the selected facility's certifier summary changes without a field edit", async () => {
    const onSubmit = vi.fn();
    const { container, rerender } = render(<CreditBatchForm creditBatch={creditBatch} onSubmit={onSubmit} />);
    await act(async () => {});
    expect(screen.queryByText(MONTH_REFUSAL)).toBeNull();
    fireEvent.submit(container.querySelector("form")!);
    await screen.findByText(MONTH_REFUSAL);

    mocks.certifierSummary.mockReturnValue({ data: { mapping: null } });
    rerender(<CreditBatchForm creditBatch={creditBatch} onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.queryByText(MONTH_REFUSAL)).toBeNull());
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    onSubmit.mockClear();
    mocks.certifierSummary.mockReturnValue({ data: { mapping: { provider: "isometric" } } });
    rerender(<CreditBatchForm creditBatch={creditBatch} onSubmit={onSubmit} />);
    await screen.findByText(MONTH_REFUSAL);
    await act(async () => { fireEvent.submit(container.querySelector("form")!); });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
