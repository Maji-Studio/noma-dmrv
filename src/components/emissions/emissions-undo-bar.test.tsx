// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmissionsUndoBar, UNDO_VISIBLE_MS } from "./emissions-undo-bar";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EmissionsUndoBar", () => {
  it("dismisses after its visible time even when the parent re-renders meanwhile", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<EmissionsUndoBar message="Deleted." onUndo={vi.fn()} onDismiss={first} />);
    act(() => vi.advanceTimersByTime(UNDO_VISIBLE_MS - 1_000));
    rerender(<EmissionsUndoBar message="Deleted." onUndo={vi.fn()} onDismiss={latest} />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("holds while Undo runs", () => {
    const onDismiss = vi.fn();
    render(<EmissionsUndoBar message="Deleted." onUndo={vi.fn()} onDismiss={onDismiss} undoing />);
    act(() => vi.advanceTimersByTime(UNDO_VISIBLE_MS * 2));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
