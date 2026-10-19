// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RECORD_LOCK_LIST_ERROR_MESSAGE } from "@/lib/record-lock-view";
import { RecordLockListNotice } from "./record-lock-list-notice";

afterEach(cleanup);

describe("RecordLockListNotice", () => {
  it("says the check failed and retries through the hook", () => {
    const retry = vi.fn();
    render(<RecordLockListNotice read={{ failed: true, retry, retrying: false }} />);
    expect(screen.getByText(RECORD_LOCK_LIST_ERROR_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while pending or once ready", () => {
    const { container } = render(<RecordLockListNotice read={{ failed: false, retry: vi.fn(), retrying: false }} />);
    expect(container.textContent).toBe("");
  });
});
