// @vitest-environment jsdom
import { useEffect, useState, type ReactNode } from "react";
import { ActionError } from "@/lib/action-error";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleWithRelations } from "@/data-access/samples";
import { expectStayedClean, renderReportingDirty } from "../../../tests/helpers/form-dialog-dirty";
import { SampleForm } from "./sample-form";

const autoSelect = vi.hoisted(() => ({ on: false }));
const batch = vi.hoisted(() => ({
  data: undefined as undefined | {
    durabilityOption: "200_year" | "1000_year";
    sampling: "sampled" | "unsampled" | null | undefined;
    facilityTimezone: string;
  },
  status: "pending" as "pending" | "success",
}));

vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useBatchDurabilitySummary: () => batch,
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility" }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
}));
vi.mock("@/components/forms", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms")>(),
  EntitySelect: ({ id, value, onChange, onAutoSelect, disabled }: { id: string; value: string; onChange: (value: string) => void; onAutoSelect?: (value: string) => void; disabled: boolean }) => {
    // The real select picks a facility's only batch by itself (autoSelectSingle).
    useEffect(() => { if (autoSelect.on && !value) (onAutoSelect ?? onChange)("00000000-0000-4000-8000-000000000001"); }, [value, onChange, onAutoSelect]);
    return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
      <option value="">Choose a batch</option>
      <option value="00000000-0000-4000-8000-000000000001">CB-1</option>
    </select>
    );
  },
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./sample-batch-progress", () => ({ SampleBatchProgress: () => null }));
vi.mock("./sample-trailing-sections", () => ({ SampleEvidenceSection: () => null, SampleTransportSection: () => <div data-testid="sample-transport-step" /> }));

const saved = {
  id: "sample", creditBatchId: "00000000-0000-4000-8000-000000000001",
  samplingTime: new Date("2026-09-10T08:12:34Z"),
  totalCarbonPercent: 80, organicCarbonPercent: 75, inorganicCarbonPercent: 2,
  totalHydrogenPercent: 1.5, totalOxygenPercent: null, oToCOrgRatio: 0.1,
  durabilityOption: null,
  randomReflectanceR0Percent: 2.4, sReflectanceFraction: 0.92,
  r0MeasurementCount: 500, r0AnalysisDate: "2026-09-11",
  residualCarbonPercent: 65, reactiveCarbonPercent: 35, tgaAnalysisDate: "2026-09-12",
} as unknown as SampleWithRelations;

function loadBatch(durabilityOption: "200_year" | "1000_year" = "1000_year", sampling: "sampled" | "unsampled" = "sampled") {
  batch.data = { durabilityOption, sampling, facilityTimezone: "UTC" };
  batch.status = "success";
}

function input(container: HTMLElement, id: string) {
  return container.querySelector<HTMLInputElement>(`#${id}`)!;
}

beforeEach(() => { batch.data = undefined; batch.status = "pending"; autoSelect.on = false; });
afterEach(cleanup);

describe("SampleForm transport step", () => {
  it("hides the Transport step", () => {
    loadBatch();
    const { queryAllByTestId } = render(<SampleForm creditBatchId={saved.creditBatchId!} onSubmit={vi.fn()} />);
    expect(queryAllByTestId("sample-transport-step")).toHaveLength(0);
  });
});

describe("SampleForm defaults and batch hydration", () => {
  it("starts sampling time empty and requires an explicit time on create", async () => {
    loadBatch("200_year");
    const onSubmit = vi.fn();
    const { container } = render(<SampleForm creditBatchId={saved.creditBatchId!} onSubmit={onSubmit} />);
    expect(input(container, "samplingTime").value).toBe("");
    fireEvent.change(input(container, "totalCarbonPercent"), { target: { value: "80" } });
    fireEvent.change(input(container, "organicCarbonPercent"), { target: { value: "75" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(container.querySelector("#samplingTime-error")).not.toBeNull());
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(input(container, "samplingTime"), { target: { value: "2026-09-10T08:12" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });

  it("keeps the saved sampling instant, including seconds, on an untouched edit", async () => {
    loadBatch();
    const onSubmit = vi.fn();
    const { container } = render(<SampleForm sample={saved} onSubmit={onSubmit} />);
    expect(input(container, "samplingTime").value).toBe("2026-09-10T08:12");
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].samplingTime).toEqual(saved.samplingTime);
    expect(onSubmit.mock.calls[0][1]).toBeTypeOf("function");
  });

  it.each([null, "200_year", "1000_year"])("preserves all saved 1,000-year evidence while the batch tier loads (saved mirror %s)", async (durabilityOption) => {
    const onSubmit = vi.fn();
    const sample = { ...saved, durabilityOption } as SampleWithRelations;
    const view = render(<SampleForm sample={sample} onSubmit={onSubmit} />);
    expect(view.container.querySelector("#randomReflectanceR0Percent")).toBeNull();
    loadBatch();
    view.rerender(<SampleForm sample={sample} onSubmit={onSubmit} />);
    await waitFor(() => expect(input(view.container, "randomReflectanceR0Percent").value).toBe("2.4"));
    expect(input(view.container, "sReflectanceFraction").value).toBe("92");
    expect(input(view.container, "r0MeasurementCount").value).toBe("500");
    expect(input(view.container, "r0AnalysisDate").value).toBe("2026-09-11");
    expect(input(view.container, "reactiveCarbonPercent").value).toBe("35");
    expect(input(view.container, "residualCarbonPercent").value).toBe("65");
    expect(input(view.container, "tgaAnalysisDate").value).toBe("2026-09-12");
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      durabilityOption: "1000_year", randomReflectanceR0Percent: 2.4,
      sReflectanceFraction: 0.92, r0MeasurementCount: 500, reactiveCarbonPercent: 35, residualCarbonPercent: 65,
    });
  });

  it("allows saving a 1,000-year Sample without s_fraction", async () => {
    loadBatch();
    const onSubmit = vi.fn();
    const { container } = render(<SampleForm sample={{ ...saved, sReflectanceFraction: null }} onSubmit={onSubmit} />);
    expect(container.querySelector('label[for="sReflectanceFraction"]')?.textContent).not.toContain("Required");
    expect(container.querySelector("#sReflectanceFraction-cert")).not.toBeNull();
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });

  it("rejects a decimal count without truncating it at input registration", async () => {
    loadBatch();
    const onSubmit = vi.fn();
    const { container } = render(<SampleForm sample={saved} onSubmit={onSubmit} />);
    fireEvent.change(input(container, "r0MeasurementCount"), { target: { value: "500.9" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(container.querySelector("#r0MeasurementCount-error")?.textContent).toBe("Enter a whole number of readings."));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(input(container, "r0MeasurementCount"), { target: { value: "501" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].r0MeasurementCount).toBe(501);
  });
});

describe("SampleForm contextual CERT chips", () => {
  it.each([
    ["1000_year", "sampled", true], ["1000_year", "unsampled", false],
    ["200_year", "sampled", false], ["200_year", "unsampled", false],
    ["1000_year", null, false], ["1000_year", undefined, false],
    ["200_year", null, false], ["200_year", undefined, false],
  ] as const)("follows the descriptor on %s %s batches", (tier, sampling, shown) => {
    batch.data = { durabilityOption: tier, sampling, facilityTimezone: "UTC" };
    batch.status = "success";
    const { container } = render(<SampleForm sample={saved} onSubmit={vi.fn()} />);
    for (const field of ["totalCarbonPercent", "inorganicCarbonPercent"]) {
      expect(container.querySelector(`#${field}-cert`) !== null, field).toBe(shown);
    }
    for (const field of ["organicCarbonPercent", "totalHydrogenPercent", "oToCOrgRatio", "moistureContentPercent"]) {
      expect(container.querySelector(`#${field}-cert`) !== null, field).toBe(sampling !== "unsampled");
    }
    for (const field of ["randomReflectanceR0Percent", "reactiveCarbonPercent", "residualCarbonPercent"]) {
      expect(container.querySelector(`#${field}-cert`) !== null, field).toBe(false);
    }
    expect(container.querySelector("#sReflectanceFraction-cert") !== null).toBe(shown);
  });

  it.each(["sampled", "unsampled"] as const)("scopes chemistry and s_fraction chips to sampled batches (%s)", (sampling) => {
    loadBatch("1000_year", sampling);
    const { container } = render(<SampleForm sample={saved} onSubmit={vi.fn()} />);
    for (const field of ["organicCarbonPercent", "totalHydrogenPercent", "oToCOrgRatio", "totalCarbonPercent", "sReflectanceFraction"]) {
      expect(container.querySelector(`#${field}-cert`) !== null).toBe(sampling === "sampled");
    }
  });
});

describe("SampleForm unsaved changes", () => {
  it("stays clean when the only batch is picked for the operator and its tier resolves", async () => {
    autoSelect.on = true;
    loadBatch("1000_year");
    const { states, container } = renderReportingDirty(<SampleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(input(container, "creditBatchId").value).toBe("00000000-0000-4000-8000-000000000001"));
    expectStayedClean(states);
  });

  it("stays clean when a preselected batch resolves", async () => {
    loadBatch("1000_year");
    const { states } = renderReportingDirty(<SampleForm creditBatchId={saved.creditBatchId!} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(states.length).toBeGreaterThan(0));
    expectStayedClean(states);
  });

  it("turns dirty once the operator picks a batch", async () => {
    loadBatch("1000_year");
    const { states, container } = renderReportingDirty(<SampleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const select = input(container, "creditBatchId");
    fireEvent.change(select, { target: { value: "00000000-0000-4000-8000-000000000001" } });
    await waitFor(() => expect(states.at(-1)).toBe(true));
  });
});

describe("SampleForm save refusal (#1327)", () => {
  const LOCK_REASON = "A Removal holds this sample. Correct the Removal first.";
  const issue = (path: string[], message: string, code = "validation_failed") => ({ path, code, message });

  /** The parent's catch: `setError(onRefusal(error, fallback))`. */
  function RefusingSampleForm({ refusal }: { refusal: unknown }) {
    const [error, setError] = useState<string | null>(null);
    return (
      <SampleForm
        sample={saved}
        errorMessage={error ?? undefined}
        onSubmit={(_data, onRefusal) => { setError(onRefusal(refusal, "Sample was not saved. Try again.")); }}
      />
    );
  }

  async function saveRefused(refusal: unknown, edit?: (container: HTMLElement) => void) {
    loadBatch();
    const view = render(<RefusingSampleForm refusal={refusal} />);
    edit?.(view.container);
    await waitFor(() => expect(input(view.container, "labName")).not.toBeNull());
    fireEvent.submit(view.container.querySelector("form")!);
    return view.container;
  }

  it("shows a refusal that names a field at that field and not in the footer", async () => {
    const container = await saveRefused(new ActionError({
      error: "Lab was not found.", code: "validation_failed", issues: [issue(["labName"], "Lab was not found.")],
    }));
    await waitFor(() => expect(container.querySelector("#labName-error")?.textContent).toBe("Lab was not found."));
    expect(container.textContent).not.toContain("Try again.");
  });

  it("keeps a code clash in the footer, since the sample form has no code field", async () => {
    const message = 'Code "SMP-26-001" already exists. Use a different code.';
    const container = await saveRefused(new ActionError({ error: message, code: "validation_failed", issues: [issue(["code"], message, "conflict")] }));
    await waitFor(() => expect(container.textContent).toContain("already exists"));
    expect(container.querySelector('[id$="-error"]')).toBeNull();
  });

  it("sends a locked field back to the saved value and says why once", async () => {
    const container = await saveRefused(
      new ActionError({ error: LOCK_REASON, code: "certification_locked", issues: [issue(["labName"], LOCK_REASON, "certification_locked")] }),
      (form) => fireEvent.change(input(form, "labName"), { target: { value: "Typed lab" } }),
    );
    await waitFor(() => expect(container.querySelector("#labName-error")?.textContent).toBe("Locked. Your change was not saved."));
    expect(input(container, "labName").value).toBe(String((saved as { labName?: string | null }).labName ?? ""));
    expect(container.textContent?.split("A Removal holds this sample").length).toBe(2);
  });
});
