// @vitest-environment jsdom
/** The Lab Sample footer repeats the form's selected credit batch. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SampleCreditBatchLine } from "./sample-credit-batch-line";

const summary = vi.fn();
vi.mock("@/hooks/use-certification", () => ({
  useBatchDurabilitySummary: (...args: unknown[]) => summary(...args),
}));

afterEach(() => {
  cleanup();
  summary.mockReset();
});

describe("SampleCreditBatchLine", () => {
  it("links the selected batch's code in a new tab", () => {
    summary.mockReturnValue({ data: { creditBatchCode: "CB-26-009" }, isError: false, isFetching: false, refetch: vi.fn() });
    render(<SampleCreditBatchLine creditBatchId="batch-1" />);
    const link = screen.getByRole("link", { name: /CB-26-009/ });
    expect(link.getAttribute("href")).toBe("/credit-batches/batch-1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("status").textContent).toContain("Credit batch: CB-26-009");
  });

  it("says Not set with nothing selected, and does not look the batch up", () => {
    summary.mockReturnValue({ data: undefined, isError: false, isSuccess: false, isFetching: false, refetch: vi.fn() });
    render(<SampleCreditBatchLine creditBatchId="" />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch: Not set");
    expect(screen.queryByRole("link")).toBeNull();
    expect(summary).toHaveBeenCalledWith("", false);
  });

  it("offers Retry when the lookup failed", () => {
    summary.mockReturnValue({ data: undefined, isError: true, isFetching: false, refetch: vi.fn() });
    render(<SampleCreditBatchLine creditBatchId="batch-1" />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows the error and Retry when a refetch failed but data is retained", () => {
    summary.mockReturnValue({ data: { creditBatchCode: "CB-26-009" }, isError: true, isFetching: false, refetch: vi.fn() });
    render(<SampleCreditBatchLine creditBatchId="batch-1" />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says the batch was not found, with no Retry, when the lookup succeeded but the batch is gone", () => {
    summary.mockReturnValue({ data: null, isError: false, isSuccess: true, isFetching: false, refetch: vi.fn() });
    render(<SampleCreditBatchLine creditBatchId="batch-1" />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch not found");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
