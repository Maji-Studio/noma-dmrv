// @vitest-environment jsdom
/** The saved-record line reads the hook and renders each state. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordCreditBatchLine } from "./record-credit-batch-line";

const hook = vi.fn();
vi.mock("@/hooks/use-record-credit-batches", () => ({
  useRecordCreditBatches: (...args: unknown[]) => hook(...args),
}));

afterEach(() => {
  cleanup();
  hook.mockReset();
});

const result = (over: object) => ({ data: undefined, isError: false, isFetching: false, refetch: vi.fn(), ...over });

describe("RecordCreditBatchLine", () => {
  it("says Not applicable for a held out application, with no link", () => {
    hook.mockReturnValue(result({ data: { batches: [], heldOut: true } }));
    render(<RecordCreditBatchLine kind="application" id="a1" />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch: Not applicable");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says Not yet computed without an id", () => {
    hook.mockReturnValue(result({}));
    render(<RecordCreditBatchLine kind="delivery" />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch: Not yet computed");
  });

  it("says None for a saved record with no batch", () => {
    hook.mockReturnValue(result({ data: { batches: [], heldOut: false } }));
    render(<RecordCreditBatchLine kind="feedstock" id="f1" />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch: None");
  });
});
