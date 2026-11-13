// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemovalMissingNotice } from "./removal-missing-notice";

const mocks = vi.hoisted(() => ({
  presence: undefined as string | undefined,
  push: vi.fn(),
  mutateAsync: vi.fn(),
  error: null as Error | null,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/hooks/use-removal-resend", () => ({
  useRemovalRegistryPresence: () => ({ data: mocks.presence }),
  usePrepareRemovalResend: () => ({ mutateAsync: mocks.mutateAsync, isPending: false, isSuccess: false, error: mocks.error }),
}));

const props = { facilityId: "f1", removalId: "r1", reviewHref: "/removals?resume=r1&facility=f1" };

describe("RemovalMissingNotice", () => {
  beforeEach(() => {
    mocks.presence = "missing";
    mocks.error = null;
    mocks.push.mockReset();
    mocks.mutateAsync.mockReset().mockResolvedValue({});
  });
  afterEach(cleanup);

  it.each(["present", "unknown", undefined])("shows nothing when the check says %s", (state) => {
    mocks.presence = state;
    const { container } = render(<RemovalMissingNotice {...props} />);
    expect(container.childElementCount).toBe(0);
  });

  it("prepares the resend, then opens the review", async () => {
    render(<RemovalMissingNotice {...props} />);
    expect(screen.getByText("Missing in Isometric")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(props.reviewHref));
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ facilityId: "f1", removalId: "r1" });
  });

  it("stays on the sheet and shows the message when preparing fails", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("Isometric still has it."));
    mocks.error = new Error("Isometric still has it.");
    render(<RemovalMissingNotice {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled());
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Isometric still has it.");
  });
});
