// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleWithRelations } from "@/data-access/samples";
import { SampleForm } from "./sample-form";

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
  EntitySelect: ({ id, value, onChange, disabled }: { id: string; value: string; onChange: (value: string) => void; disabled: boolean }) => (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
      <option value="">Choose a batch</option>
      <option value="00000000-0000-4000-8000-000000000001">CB-1</option>
    </select>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./sample-batch-progress", () => ({ SampleBatchProgress: () => null }));
vi.mock("./sample-trailing-sections", () => ({ SampleEvidenceSection: () => null, SampleTransportSection: () => null }));

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

beforeEach(() => { batch.data = undefined; batch.status = "pending"; });
afterEach(cleanup);

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
    for (const field of ["organicCarbonPercent", "totalHydrogenPercent", "oToCOrgRatio"]) {
      expect(container.querySelector(`#${field}-cert`) !== null, field).toBe(sampling !== "unsampled");
    }
    for (const field of ["randomReflectanceR0Percent", "reactiveCarbonPercent", "residualCarbonPercent"]) {
      expect(container.querySelector(`#${field}-cert`) !== null, field).toBe(tier === "1000_year");
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
