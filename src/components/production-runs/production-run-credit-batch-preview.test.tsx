// @vitest-environment jsdom
/**
 * The footer line asks the server again as the form changes, and only ever
 * shows the answer for the current inputs: a late answer for earlier inputs
 * never appears as current. A failed check is not "no batch" and offers Retry.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/types/actions";
import type { ProductionRunCreditBatchPreviewInput } from "@/schemas/production-run-credit-batch-preview";
import type { ProductionRunCreditBatchPreview } from "@/types/production-run-credit-batch-preview";
import {
  buildCreditBatchPreviewInput,
  ProductionRunCreditBatchPreview as PreviewLine,
  type CreditBatchPreviewFormValues,
} from "./production-run-credit-batch-preview";

type Answer = ActionResult<ProductionRunCreditBatchPreview>;
const calls: Array<{ input: ProductionRunCreditBatchPreviewInput; resolve: (answer: Answer) => void }> = [];

vi.mock("@/fn/production-run-credit-batch-preview", () => ({
  previewProductionRunCreditBatchFn: (input: ProductionRunCreditBatchPreviewInput) =>
    new Promise<Answer>((resolve) => calls.push({ input, resolve })),
}));

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const BIN_ID = "22222222-2222-4222-8222-222222222222";
const TIME_ZONE = "Africa/Dar_es_Salaam";
const BASIS = { dayBasis: "end" as const, facilityName: "Mafinga Facility", timeZone: TIME_ZONE, feedstockTypeName: "Forestry waste" };
const SEPTEMBER = { id: "sep", code: "CB-26-009", startDate: "2026-09-01", endDate: "2026-09-30" };
const OCTOBER = { id: "oct", code: "CB-26-010", startDate: "2026-10-01", endDate: "2026-10-31" };

const VALUES: CreditBatchPreviewFormValues = {
  status: "complete",
  startDate: "2026-09-30",
  startTime: "08:00",
  endDate: "2026-09-30",
  endTime: "16:00",
  feedstockDraws: [{ storageLocationId: BIN_ID }],
};

function Harness() {
  const { control, register } = useForm<CreditBatchPreviewFormValues>({ defaultValues: VALUES });
  return (
    <>
      <input aria-label="End date" type="date" {...register("endDate")} />
      <PreviewLine control={control} facilityId={FACILITY_ID} productionRunId={undefined} timeZone={TIME_ZONE} clearEndTime={false} />
    </>
  );
}

let client: QueryClient;

function renderLine() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const status = () => screen.getByRole("status");

afterEach(() => {
  cleanup();
  calls.length = 0;
});

describe("buildCreditBatchPreviewInput", () => {
  it("resolves the facility wall clock to instants, as the save does", () => {
    expect(buildCreditBatchPreviewInput(VALUES, { facilityId: FACILITY_ID, productionRunId: undefined, timeZone: TIME_ZONE, clearEndTime: false })).toEqual({
      facilityId: FACILITY_ID,
      productionRunId: null,
      status: "complete",
      // 08:00 and 16:00 in UTC+3.
      startTime: "2026-09-30T05:00:00.000Z",
      endTime: "2026-09-30T13:00:00.000Z",
      feedstockStorageLocationIds: [BIN_ID],
    });
  });

  it("reads an end time without an end date on the start date, and drops blank or repeated bins", () => {
    const input = buildCreditBatchPreviewInput(
      { ...VALUES, endDate: "", feedstockDraws: [{ storageLocationId: "" }, { storageLocationId: BIN_ID }, { storageLocationId: BIN_ID }] },
      { facilityId: "", productionRunId: "run", timeZone: TIME_ZONE, clearEndTime: false },
    );
    expect(input.endTime).toBe("2026-09-30T13:00:00.000Z");
    expect(input.feedstockStorageLocationIds).toEqual([BIN_ID]);
    expect(input.facilityId).toBeNull();
    expect(input.productionRunId).toBe("run");
  });

  it("drops the end time a reopened run's save clears", () => {
    const input = buildCreditBatchPreviewInput(
      { ...VALUES, status: "running" },
      { facilityId: FACILITY_ID, productionRunId: "run", timeZone: TIME_ZONE, clearEndTime: true },
    );
    expect(input.endTime).toBeNull();
    expect(input.startTime).toBe("2026-09-30T05:00:00.000Z");
  });

  it("leaves unfinished times empty instead of guessing", () => {
    const input = buildCreditBatchPreviewInput({ ...VALUES, endTime: "", startTime: undefined }, { facilityId: FACILITY_ID, productionRunId: undefined, timeZone: TIME_ZONE, clearEndTime: false });
    expect(input.startTime).toBeNull();
    expect(input.endTime).toBeNull();
  });
});

describe("ProductionRunCreditBatchPreview", () => {
  it("never shows an earlier answer for changed inputs", async () => {
    renderLine();
    expect(status().textContent).toContain("Checking credit batch...");
    await waitFor(() => expect(calls).toHaveLength(1));

    // The operator moves the end across the batch boundary before the first answer.
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].input.endTime).toBe("2026-10-01T13:00:00.000Z");

    // The late September answer lands for the old inputs only.
    await act(async () => {
      calls[0].resolve({ success: true, data: { state: "match", batch: SEPTEMBER, basis: { ...BASIS, day: "2026-09-30" }, expected: false } });
    });
    expect(status().textContent).toContain("Checking credit batch...");
    expect(status().textContent).not.toContain("CB-26-009");

    await act(async () => {
      calls[1].resolve({ success: true, data: { state: "match", batch: OCTOBER, basis: { ...BASIS, day: "2026-10-01" }, expected: false } });
    });
    await waitFor(() => expect(status().textContent).toContain("Joins credit batch CB-26-010 (opens in a new tab) (Oct 1 to Oct 31, 2026)"));
    expect(status().textContent).not.toContain("CB-26-009");
  });

  it("clears a shown match as soon as an input changes", async () => {
    renderLine();
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve({ success: true, data: { state: "match", batch: SEPTEMBER, basis: { ...BASIS, day: "2026-09-30" }, expected: false } });
    });
    await waitFor(() => expect(status().textContent).toContain("CB-26-009"));

    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-01" } });
    expect(status().textContent).toContain("Checking credit batch...");
    expect(status().getAttribute("aria-busy")).toBe("true");
  });

  it("hides the last answer while the same inputs are checked again", async () => {
    renderLine();
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve({ success: true, data: { state: "match", batch: SEPTEMBER, basis: { ...BASIS, day: "2026-09-30" }, expected: false } });
    });
    await waitFor(() => expect(status().textContent).toContain("CB-26-009"));

    // A batch changed elsewhere (another tab, a save): the preview refetches.
    await act(async () => {
      void client.invalidateQueries();
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(status().textContent).toContain("Checking credit batch...");
    expect(status().textContent).not.toContain("CB-26-009");

    await act(async () => {
      calls[1].resolve({ success: true, data: { state: "no-match", basis: { ...BASIS, day: "2026-09-30" }, expected: false } });
    });
    await waitFor(() => expect(status().textContent).toContain("No credit batch covers Sep 30, 2026 yet."));
  });

  it("checks again when the inputs go back to earlier values", async () => {
    renderLine();
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve({ success: true, data: { state: "match", batch: SEPTEMBER, basis: { ...BASIS, day: "2026-09-30" }, expected: false } });
    });
    await waitFor(() => expect(status().textContent).toContain("CB-26-009"));

    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(calls).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-30" } });
    await waitFor(() => expect(calls).toHaveLength(3));
    // The September answer may be outdated by now: it is asked for again, not reused.
    expect(status().textContent).toContain("Checking credit batch...");
    expect(status().textContent).not.toContain("CB-26-009");
  });

  it("links the batch code in a new tab so the unsaved run stays open", async () => {
    renderLine();
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve({ success: true, data: { state: "match", batch: SEPTEMBER, basis: { ...BASIS, day: "2026-09-30" }, expected: false } });
    });
    const link = await screen.findByRole("link", { name: /CB-26-009/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("href")).toBe(`/credit-batches/sep?facility=${FACILITY_ID}`);
    expect(screen.getByRole("button", { name: "How the credit batch is chosen" })).toBeTruthy();
  });

  it("says a failed check failed, and Retry asks again", async () => {
    renderLine();
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve({ success: false, error: "The action could not be completed. Try again." });
    });
    await waitFor(() => expect(status().textContent).toContain("Credit batch could not be checked."));
    expect(status().textContent).not.toContain("No credit batch");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => {
      calls[1].resolve({ success: true, data: { state: "no-match", basis: { ...BASIS, day: "2026-09-30" }, expected: false } });
    });
    await waitFor(() => expect(status().textContent).toContain("No credit batch covers Sep 30, 2026 yet."));
  });
});
