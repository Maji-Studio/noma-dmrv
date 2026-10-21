// @vitest-environment jsdom
/** The line reads saved provenance, or previews from the form's source, and renders each state. */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CREDIT_BATCH_PREVIEW_DEBOUNCE_MS } from "./credit-batch-line-copy";
import { RecordCreditBatchLine } from "./record-credit-batch-line";

const hook = vi.fn();
const previewHook = vi.fn();
vi.mock("@/hooks/use-record-credit-batches", () => ({
  useRecordCreditBatches: (...args: unknown[]) => hook(...args),
}));
vi.mock("@/hooks/use-record-credit-batch-preview", () => ({
  useRecordCreditBatchPreview: (...args: unknown[]) => previewHook(...args),
}));

beforeEach(() => {
  hook.mockReturnValue(result({}));
  previewHook.mockReturnValue(result({}));
});

afterEach(() => {
  cleanup();
  hook.mockReset();
  previewHook.mockReset();
  vi.useRealTimers();
});

const result = (over: object) => ({ data: undefined, isError: false, isFetching: false, refetch: vi.fn(), ...over });
const BIN = { storageLocationId: "bin-1", facilityId: "fac-1", occurredAt: "2026-10-21T08:00:00.000Z" };
const BATCH = { id: "b1", code: "CB-26-001", startDate: "2026-09-01", endDate: "2026-09-30" };

describe("RecordCreditBatchLine", () => {
  it("says Not applicable for a held out application, with no link", () => {
    hook.mockReturnValue(result({ data: { batches: [], heldOut: true } }));
    render(<RecordCreditBatchLine kind="application" id="a1" />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch: Not applicable");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says when a new feedstock's batch is set", () => {
    render(<RecordCreditBatchLine kind="feedstock" />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch: Set when a production run uses this feedstock");
  });

  it("says None for a saved record with no batch", () => {
    hook.mockReturnValue(result({ data: { batches: [], heldOut: false } }));
    render(<RecordCreditBatchLine kind="feedstock" id="f1" />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch: None");
  });

  it("names what decides the batch before a source is chosen, without asking the server", () => {
    render(<RecordCreditBatchLine kind="delivery" preview={null} />);
    expect(screen.getByRole("status").textContent).toContain("Choose a source bin to see the credit batch.");
    expect(previewHook).toHaveBeenLastCalledWith(null);
    expect(hook).toHaveBeenLastCalledWith("delivery", undefined);
  });

  it("previews the batch once the source settles, and says Checking while it changes", () => {
    vi.useFakeTimers();
    const input = { kind: "delivery" as const, bin: BIN, draw: null };
    previewHook.mockReturnValue(result({ data: { batches: [BATCH], heldOut: false, exact: false, sourceRunCount: 1, unbatchedRunCount: 0 } }));
    const { rerender } = render(<RecordCreditBatchLine kind="delivery" preview={null} />);
    rerender(<RecordCreditBatchLine kind="delivery" preview={input} />);
    expect(screen.getByRole("status").textContent).toContain("Checking credit batch...");
    act(() => vi.advanceTimersByTime(CREDIT_BATCH_PREVIEW_DEBOUNCE_MS));
    expect(previewHook).toHaveBeenLastCalledWith(input);
    expect(screen.getByRole("status").textContent).toContain("Joins credit batch CB-26-001");
    expect(screen.getByRole("link", { name: /CB-26-001/ })).toBeTruthy();
  });

  it("never shows an earlier answer while a check runs", () => {
    previewHook.mockReturnValue(result({ isFetching: true, data: { batches: [BATCH], heldOut: false, exact: true, sourceRunCount: 1, unbatchedRunCount: 0 } }));
    render(<RecordCreditBatchLine kind="application" preview={{ kind: "application", deliveryId: "d1", appliedWetMassKg: 5, applicationId: null }} />);
    expect(screen.getByRole("status").textContent).toContain("Checking credit batch...");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers Retry when the preview fails", () => {
    const refetch = vi.fn();
    previewHook.mockReturnValue(result({ isError: true, refetch }));
    render(<RecordCreditBatchLine kind="biochar-product" preview={{ kind: "biochar-product", bin: BIN, draw: null }} />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch could not be checked.");
    act(() => screen.getByRole("button", { name: "Retry" }).click());
    expect(refetch).toHaveBeenCalled();
  });
});
