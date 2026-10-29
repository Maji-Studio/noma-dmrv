// @vitest-environment jsdom
import { useEffect, useState, type ReactNode } from "react";
import { ActionError } from "@/lib/action-error";
import { OPEN_LOCK } from "../../../tests/helpers/record-lock-mocks";
import { useController, type Control } from "react-hook-form";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import type { CreditBatch } from "@/db/schema/credits";
import { expectStayedClean, renderReportingDirty } from "../../../tests/helpers/form-dialog-dirty";
import { CreditBatchForm } from "./credit-batch-form";

const mocks = vi.hoisted(() => ({
  certifierSummary: vi.fn(), methodBEligibility: vi.fn(), recordPrerequisites: vi.fn(),
  claimedRun: null as null | { endsOn: string; run: Record<string, unknown> },
  extraRuns: [] as Record<string, unknown>[],
  showFacilitySelect: false, showFeedstockSelect: false, realPicker: false, autoPick: false, timeZone: "UTC",
  contextFacilityId: "facility",
  nameSuggestion: undefined as undefined | { nextCode: string; name: string | null },
}));

const ISOMETRIC_FACILITY_ID = "00000000-0000-4000-8000-000000000002";
const UNMAPPED_FACILITY_ID = "00000000-0000-4000-8000-000000000004";
const FEEDSTOCK_TYPE_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_FEEDSTOCK_TYPE_ID = "00000000-0000-4000-8000-000000000004";
const EARLIER_PROCESS_ID = "00000000-0000-4000-8000-000000000005";
const LATER_PROCESS_ID = "00000000-0000-4000-8000-000000000006";
const MONTH_REFUSAL = "Choose an end date on or before Jan 31, 2026. Isometric credit batches must cover less than one month.";

type SelectFields = { facilityId: string; feedstockTypeId: string };

function FacilitySelect({ control }: { control: Control<SelectFields> }) {
  const { field } = useController({ control, name: "facilityId" });
  return (
    <select aria-label="Facility" {...field}>
      <option value={ISOMETRIC_FACILITY_ID}>Isometric facility</option>
      <option value={UNMAPPED_FACILITY_ID}>Facility without a certifier</option>
    </select>
  );
}

function FeedstockSelect({ control }: { control: Control<SelectFields> }) {
  const { field } = useController({ control, name: "feedstockTypeId" });
  return (
    <select aria-label="Feedstock type" {...field}>
      <option value="">Select feedstock type</option>
      <option value={FEEDSTOCK_TYPE_ID}>Pyrolysis feedstock</option>
      <option value={OTHER_FEEDSTOCK_TYPE_ID}>Other feedstock</option>
    </select>
  );
}

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: mocks.timeZone, hint: "" }),
  useFacilityContext: () => ({ facilityId: mocks.contextFacilityId }) }));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useFacilityCertifierSummary: mocks.certifierSummary,
}));
vi.mock("@/hooks/use-feedstock-types", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-feedstock-types")>(),
  useFeedstockTypeList: () => ({ data: [{ id: FEEDSTOCK_TYPE_ID, usage: "pyrolysis" }] }),
}));
vi.mock("@/hooks/use-production-processes", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-production-processes")>(),
  useMethodBEligibility: mocks.methodBEligibility,
  useRecordMethodBPrerequisites: () => ({ mutateAsync: mocks.recordPrerequisites, isPending: false }),
}));
vi.mock("@/hooks/use-credit-batches", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-credit-batches")>(),
  useCreditBatchNameSuggestion: (_facilityId: string | undefined, enabled: boolean) => ({
    data: enabled ? mocks.nameSuggestion : undefined,
  }),
  useCreditBatchProductionRunOptions: (params: { endDate?: string }) => ({
    // A claimed run is in the window once the batch ends on or after the run's own end.
    data: mocks.claimedRun && params.endDate && params.endDate >= mocks.claimedRun.endsOn ? [mocks.claimedRun.run, ...mocks.extraRuns] : [],
    isSuccess: true,
  }),
}));
vi.mock("@/components/forms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/forms")>();
  return {
    ...actual,
    // Expose selected fields without coupling this test to the entity picker.
    FormEntitySelect: (props: Parameters<typeof actual.FormEntitySelect>[0]) => {
      const control = props.control as unknown as Control<SelectFields>;
      return mocks.realPicker ? <actual.FormEntitySelect {...props} />
        : mocks.showFacilitySelect ? <FacilitySelect control={control} />
        : mocks.showFeedstockSelect ? <FeedstockSelect control={control} /> : null;
    },
  };
});
// Under the real FormEntitySelect: a plain select that, like the real one,
// picks the lone feedstock type by itself when asked (autoSelectSingle).
vi.mock("@/components/forms/entity-select/entity-select", () => ({
  EntitySelect: ({ id, value, onChange, onAutoSelect, autoSelectSingle }: {
    id: string; value: string; onChange: (value: string) => void; onAutoSelect?: (value: string) => void; autoSelectSingle?: boolean;
  }) => {
    useEffect(() => {
      if (mocks.autoPick && autoSelectSingle && !value) (onAutoSelect ?? onChange)(FEEDSTOCK_TYPE_ID);
    }, [value, onChange, onAutoSelect, autoSelectSingle]);
    return (
      <select id={id} aria-label="Feedstock type" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select feedstock type</option>
        <option value={FEEDSTOCK_TYPE_ID}>Pyrolysis feedstock</option>
      </select>
    );
  },
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);
beforeEach(() => {
  mocks.methodBEligibility.mockClear();
  mocks.methodBEligibility.mockReturnValue({ data: undefined });
  mocks.showFacilitySelect = false;
  mocks.claimedRun = null;
  mocks.timeZone = "UTC";
  mocks.showFeedstockSelect = false;
  mocks.realPicker = false;
  mocks.autoPick = false;
  mocks.contextFacilityId = "facility";
  mocks.nameSuggestion = undefined;
  mocks.recordPrerequisites.mockReset();
  mocks.recordPrerequisites.mockResolvedValue(undefined);
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

describe("CreditBatchForm month window", () => {
  it("keeps the supplied month window when the facility zone resolves late", () => {
    const defaultValues = { startDate: "2026-09-01", endDate: "2026-09-30" };
    const { container, rerender } = render(<CreditBatchForm defaultValues={defaultValues} onSubmit={vi.fn()} />);
    mocks.timeZone = "Africa/Dar_es_Salaam";
    rerender(<CreditBatchForm defaultValues={defaultValues} onSubmit={vi.fn()} />);
    expect(container.querySelector<HTMLInputElement>('input[name="startDate"]')?.value).toBe("2026-09-01");
    expect(container.querySelector<HTMLInputElement>('input[name="endDate"]')?.value).toBe("2026-09-30");
  });
});

describe("CreditBatchForm Method-B prerequisites", () => {
  it("submits the resolved process id when switching between cached epoch results", async () => {
    mocks.showFeedstockSelect = true;
    mocks.certifierSummary.mockReturnValue({ data: { mapping: { provider: "isometric" } } });
    const eligibility = {
      eligibleSampleCount: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
      agreedBaselineSize: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
      prerequisitesRecorded: false, randomSamplingPlanRef: null, moisturePathway: null, unsampledAllowed: false,
    };
    const earlier = { data: { ...eligibility, productionProcessId: EARLIER_PROCESS_ID } };
    const later = { data: { ...eligibility, productionProcessId: LATER_PROCESS_ID } };
    mocks.methodBEligibility.mockImplementation((_facilityId, _feedstockTypeId, _enabled, startDate?: Date) =>
      startDate?.getUTCMonth() === 0 ? earlier : later,
    );
    const { container } = render(<CreditBatchForm onSubmit={vi.fn()} canManage />);
    fireEvent.change(screen.getByRole("combobox", { name: "Feedstock type" }), {
      target: { value: FEEDSTOCK_TYPE_ID },
    });

    const selections = [
      ["2025-01-01", EARLIER_PROCESS_ID],
      ["2025-06-01", LATER_PROCESS_ID],
      ["2025-01-01", EARLIER_PROCESS_ID],
    ];
    for (const [index, [day, processId]] of selections.entries()) {
      fireEvent.change(container.querySelector('input[name="startDate"]')!, { target: { value: day } });
      fireEvent.click(screen.getByRole("button", { name: "Set up Method-B prerequisites" }));
      const plan = await screen.findByRole("textbox", { name: /Random sampling plan reference/ });
      expect((plan as HTMLInputElement).value).toBe("");
      fireEvent.change(plan, { target: { value: "Agreed sampling plan" } });
      fireEvent.click(screen.getByRole("button", { name: "Record prerequisites" }));
      await waitFor(() => expect(mocks.recordPrerequisites).toHaveBeenNthCalledWith(index + 1, {
        processId,
        agreedBaselineSize: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
        randomSamplingPlanRef: "Agreed sampling plan",
        moisturePathway: "measured_every_batch",
      }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
    }), expect.any(Function)));
  });

  it("refuses the same period for an Isometric facility", async () => {
    mocks.certifierSummary.mockReturnValue({ data: { mapping: { provider: "isometric" } } });
    const onSubmit = vi.fn();
    const { container } = render(<CreditBatchForm creditBatch={creditBatch} onSubmit={onSubmit} />);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByText("Choose an end date on or before Jan 31, 2026. Isometric credit batches must cover less than one month.")).toBeTruthy());
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
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ facilityId: UNMAPPED_FACILITY_ID }), expect.any(Function)));

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

describe("CreditBatchForm unsaved changes", () => {
  const SEPTEMBER = { startDate: "2026-09-01", endDate: "2026-09-30" };
  const dateValue = (container: HTMLElement, name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

  it("stays clean when the only feedstock type and its month are picked for the operator", async () => {
    mocks.realPicker = true;
    mocks.autoPick = true;
    const { states, container } = renderReportingDirty(<CreditBatchForm onSubmit={vi.fn()} onCancel={vi.fn()} windowForFeedstock={() => SEPTEMBER} />);
    await waitFor(() => expect(dateValue(container, "startDate")).toBe(SEPTEMBER.startDate));
    expect(dateValue(container, "endDate")).toBe(SEPTEMBER.endDate);
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Feedstock type" }).value).toBe(FEEDSTOCK_TYPE_ID);
    expectStayedClean(states);
  });

  it("turns dirty once the operator picks the feedstock type", async () => {
    mocks.realPicker = true;
    const { states, container } = renderReportingDirty(<CreditBatchForm onSubmit={vi.fn()} onCancel={vi.fn()} windowForFeedstock={() => SEPTEMBER} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Feedstock type" }), { target: { value: FEEDSTOCK_TYPE_ID } });
    await waitFor(() => expect(states.at(-1)).toBe(true));
    expect(dateValue(container, "startDate")).toBe(SEPTEMBER.startDate);
  });
});

describe("CreditBatchForm save refusal (#1327)", () => {
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
  const LOCK_REASON = "A Removal holds this batch. Correct the Removal first.";
  const issue = (path: string[], message: string, code = "validation_failed") => ({ path, code, message });

  /** The parent's catch: `setError(onRefusal(error, fallback))`. */
  function RefusingBatchForm({ refusal }: { refusal: unknown }) {
    const [error, setError] = useState<string | null>(null);
    return (
      <CreditBatchForm
        creditBatch={creditBatch}
        lock={OPEN_LOCK}
        errorMessage={error ?? undefined}
        onSubmit={(_data, onRefusal) => { setError(onRefusal(refusal, "Credit batch was not saved. Try again.")); }}
      />
    );
  }

  async function saveRefused(refusal: unknown, edit?: (endDate: HTMLInputElement) => void | Promise<void>) {
    mocks.certifierSummary.mockReturnValue({ data: { mapping: null } });
    const { container } = render(<RefusingBatchForm refusal={refusal} />);
    const endDate = container.querySelector<HTMLInputElement>('input[name="endDate"]')!;
    await edit?.(endDate);
    await act(async () => { fireEvent.submit(container.querySelector("form")!); });
    return { container, endDate };
  }

  it("shows a refusal that names a field at that field and not in the footer", async () => {
    const { container } = await saveRefused(new ActionError({
      error: "The end date is after today.", code: "validation_failed", issues: [issue(["endDate"], "The end date is after today.")],
    }));
    await waitFor(() => expect(container.querySelector("#endDate-error")?.textContent).toBe("The end date is after today."));
    await act(async () => {});
    expect(container.querySelector("#endDate-error")?.textContent).toBe("The end date is after today.");
    expect(container.textContent).not.toContain("Try again.");
  });

  it("keeps a code clash in the footer, since the credit batch form has no code field", async () => {
    const message = 'Code "CB-26-001" already exists. Use a different code.';
    const { container } = await saveRefused(new ActionError({ error: message, code: "validation_failed", issues: [issue(["code"], message, "conflict")] }));
    await waitFor(() => expect(container.textContent).toContain("already exists"));
    expect(container.querySelector('[id$="-error"]')).toBeNull();
  });

  it("sends a locked field back to the saved value and says why once", async () => {
    const { container, endDate } = await saveRefused(
      new ActionError({ error: LOCK_REASON, code: "certification_locked", issues: [issue(["endDate"], LOCK_REASON, "certification_locked")] }),
      (field) => { fireEvent.change(field, { target: { value: "2026-05-31" } }); },
    );
    await waitFor(() => expect(container.querySelector("#endDate-error")?.textContent).toBe("Locked. Your change was not saved."));
    await act(async () => {});
    expect(container.querySelector("#endDate-error")?.textContent).toBe("Locked. Your change was not saved.");
    expect(endDate.value).toBe("2026-04-30");
    expect(container.textContent?.split("A Removal holds this batch").length).toBe(2);
  });

  it("brings the saved production runs back with a reverted date", async () => {
    const RUN_ID = "00000000-0000-4000-8000-0000000000aa";
    const batch = creditBatch as unknown as { productionRunIds: string[] };
    batch.productionRunIds = [RUN_ID];
    mocks.claimedRun = {
      endsOn: "2026-04-15",
      run: { id: RUN_ID, code: "PR-1", status: "complete", feedstockTypeIds: [creditBatch.feedstockTypeId], assignedCreditBatchId: creditBatch.id },
    };
    try {
      const { container, endDate } = await saveRefused(
        new ActionError({ error: LOCK_REASON, code: "certification_locked", issues: [issue(["endDate"], LOCK_REASON, "certification_locked")] }),
        async (field) => {
          fireEvent.change(field, { target: { value: "2026-03-31" } });
          await act(async () => {});
          // Moving the end date back drops the claimed run, as the notice says.
          expect(document.body.textContent).toContain("Saving removes a claimed production run");
        },
      );
      await waitFor(() => expect(endDate.value).toBe("2026-04-30"));

      await act(async () => {});
      expect(container.textContent).not.toContain("Saving removes a claimed production run");
      expect(container.textContent).toContain("Not saved. 1 field is locked.");
    } finally {
      batch.productionRunIds = [];
    }
  });

  it("brings the saved production runs back with a reverted feedstock type", async () => {
    const RUN_ID = "00000000-0000-4000-8000-0000000000aa";
    const batch = creditBatch as unknown as { productionRunIds: string[] };
    batch.productionRunIds = [RUN_ID];
    mocks.showFeedstockSelect = true;
    mocks.claimedRun = {
      endsOn: "2026-04-15",
      run: { id: RUN_ID, code: "PR-1", status: "complete", feedstockTypeIds: [creditBatch.feedstockTypeId], assignedCreditBatchId: creditBatch.id },
    };
    try {
      const { container } = await saveRefused(
        new ActionError({ error: LOCK_REASON, code: "certification_locked", issues: [issue(["feedstockTypeId"], LOCK_REASON, "certification_locked")] }),
        async () => {
          fireEvent.change(screen.getByLabelText("Feedstock type"), { target: { value: OTHER_FEEDSTOCK_TYPE_ID } });
          await act(async () => {});
          expect(document.body.textContent).toContain("Saving removes a claimed production run");
        },
      );
      await waitFor(() => expect((screen.getByLabelText("Feedstock type") as HTMLSelectElement).value).toBe(FEEDSTOCK_TYPE_ID));

      await act(async () => {});
      expect(container.textContent).not.toContain("Saving removes a claimed production run");
      expect(container.textContent).toContain("Not saved. 1 field is locked.");
    } finally {
      batch.productionRunIds = [];
    }
  });
});

describe("CreditBatchForm held batch: add a missed run", () => {
  const SAVED_ID = "00000000-0000-4000-8000-0000000000a1";
  const MISSED_ID = "00000000-0000-4000-8000-0000000000a2";
  const creditBatch = {
    id: "00000000-0000-4000-8000-000000000001",
    facilityId: ISOMETRIC_FACILITY_ID,
    feedstockTypeId: FEEDSTOCK_TYPE_ID,
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    sampling: "sampled",
    certifier: null,
    productionRunIds: [SAVED_ID],
  } as unknown as CreditBatch;
  const lockOf = (level: "open" | "in_use" | "sent") => ({
    ...OPEN_LOCK,
    level,
    usedBy: level === "open" ? [] : [{ kind: "removal", id: "removal-1", label: "RM-26-001", facilityId: null }],
  }) as typeof OPEN_LOCK;
  const run = (id: string, code: string, assignedCreditBatchId: string | null) => ({
    id, code, date: "2026-01-10", status: "complete", feedstockTypeIds: [FEEDSTOCK_TYPE_ID],
    assignedCreditBatchId, biocharOutputKg: 100, biocharDryMassKg: 90, biocharStorageName: "Pad",
  });
  const setRuns = () => {
    mocks.claimedRun = { endsOn: "2026-01-10", run: run(SAVED_ID, "PR-0412", creditBatch.id) };
    mocks.extraRuns = [run(MISSED_ID, "PR-0415", null)];
  };

  afterEach(() => { mocks.extraRuns = []; });

  /** Rows of the batch's own list, not the add list below it. */
  const listedRuns = (container: HTMLElement) => [...container.querySelectorAll('[data-testid="credit-batch-production-run-preview"]')]
    .filter((row) => !row.closest('[data-testid="credit-batch-add-run"]'));

  async function renderHeld(level: "open" | "in_use" | "sent", onSubmit = vi.fn()) {
    setRuns();
    const view = render(<CreditBatchForm creditBatch={creditBatch} lock={lockOf(level)} onSubmit={onSubmit} />);
    await act(async () => {});
    return { ...view, onSubmit };
  }

  it("offers Add run on a held batch and keeps existing runs without a remove button", async () => {
    const { container } = await renderHeld("in_use");
    expect(screen.getByRole("button", { name: "Add run PR-0415" })).toBeTruthy();
    expect(listedRuns(container).length).toBe(1);
    expect(screen.queryByRole("button", { name: /^Undo adding/ })).toBeNull();
    expect(container.querySelector('a[href*="run=' + SAVED_ID + '"]')?.textContent).toBe("PR-0412");
  });

  it("moves the added run into the batch, lets it be undone, and submits it", async () => {
    const { container, onSubmit } = await renderHeld("in_use");
    fireEvent.click(screen.getByRole("button", { name: "Add run PR-0415" }));
    await act(async () => {});
    expect(listedRuns(container).length).toBe(2);
    expect(screen.queryByRole("button", { name: "Add run PR-0415" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Undo adding/ }).length).toBe(1);
    await act(async () => { fireEvent.submit(container.querySelector("form")!); });
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(new Set(onSubmit.mock.calls[0][0].productionRunIds)).toEqual(new Set([SAVED_ID, MISSED_ID]));
  });

  it("offers no Add run on a Sent batch", async () => {
    await renderHeld("sent");
    expect(screen.queryByRole("button", { name: /Add run/ })).toBeNull();
  });

  it("leaves a free batch as it was", async () => {
    await renderHeld("open");
    expect(screen.queryByRole("button", { name: /Add run/ })).toBeNull();
  });
});

describe("CreditBatchForm name suggestion", () => {
  const nameInput = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });

  async function submitBlankCreate() {
    mocks.contextFacilityId = ISOMETRIC_FACILITY_ID;
    mocks.certifierSummary.mockReturnValue({ data: { mapping: null } });
    mocks.realPicker = true;
    mocks.autoPick = true;
    const onSubmit = vi.fn();
    const { container } = render(<CreditBatchForm onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Feedstock type" }).value).toBe(FEEDSTOCK_TYPE_ID));
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    return onSubmit.mock.calls[0][0];
  }

  it("shows the continued name in grey when creating", () => {
    mocks.nameSuggestion = { nextCode: "CB-26-004", name: "Lot 08" };
    render(<CreditBatchForm onSubmit={vi.fn()} />);
    expect(nameInput().placeholder).toBe("Lot 08");
    expect(nameInput().value).toBe("");
  });

  it("shows the next code in grey when the last batch has no name to continue", () => {
    mocks.nameSuggestion = { nextCode: "CB-26-002", name: null };
    render(<CreditBatchForm onSubmit={vi.fn()} />);
    expect(nameInput().placeholder).toBe("CB-26-002");
  });

  it("saves the grey name when the field stays blank", async () => {
    mocks.nameSuggestion = { nextCode: "CB-26-004", name: "Lot 08" };
    expect((await submitBlankCreate()).name).toBe("Lot 08");
  });

  it("saves no name when the grey text is the next code, so the batch shows its code", async () => {
    mocks.nameSuggestion = { nextCode: "CB-26-002", name: null };
    expect((await submitBlankCreate()).name ?? null).toBeNull();
  });

  it("retries a blank create with the name it first sent, even once a suggestion loads", async () => {
    mocks.contextFacilityId = ISOMETRIC_FACILITY_ID;
    mocks.certifierSummary.mockReturnValue({ data: { mapping: null } });
    mocks.realPicker = true;
    mocks.autoPick = true;
    const onSubmit = vi.fn();
    const { container, rerender } = render(<CreditBatchForm onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Feedstock type" }).value).toBe(FEEDSTOCK_TYPE_ID));
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    mocks.nameSuggestion = { nextCode: "CB-26-004", name: "Lot 08" };
    rerender(<CreditBatchForm onSubmit={onSubmit} />);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[0][0].name ?? null).toBeNull();
    expect(onSubmit.mock.calls[1][0].name ?? null).toBeNull();
  });

  it("keeps the batch's own code in grey when editing", () => {
    mocks.nameSuggestion = { nextCode: "CB-26-004", name: "Lot 08" };
    const creditBatch = { id: "00000000-0000-4000-8000-000000000001", code: "CB-26-001", facilityId: ISOMETRIC_FACILITY_ID,
      feedstockTypeId: FEEDSTOCK_TYPE_ID, startDate: "2026-01-01", endDate: "2026-01-31", sampling: "sampled",
      certifier: null, productionRunIds: [] } as unknown as CreditBatch;
    render(<CreditBatchForm creditBatch={creditBatch} onSubmit={vi.fn()} />);
    expect(nameInput().placeholder).toBe("CB-26-001");
  });
});
