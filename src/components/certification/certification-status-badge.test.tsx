// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CertificationStatusBadge } from "./certification-status-badge";

vi.mock("./submission-status-history", () => ({
  SubmissionStatusHistory: () => <p>History body</p>,
}));

const HOVER_WAIT_MS = 1000;

function renderBadge() {
  render(
    <CertificationStatusBadge
      entityType="removal"
      entityId="rem-1"
      status="pending"
      label="Submitted"
    />,
  );
  return screen.getByRole("button", { name: "Submitted, status history" });
}


describe("CertificationStatusBadge", () => {
  afterEach(cleanup);

  it("opens the history on mouse hover and closes when the pointer leaves", async () => {
    const badge = renderBadge();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.pointerEnter(badge, { pointerType: "mouse" });
    fireEvent.mouseEnter(badge);
    fireEvent.mouseMove(badge);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Status history" })).toBeTruthy(), {
      timeout: HOVER_WAIT_MS,
    });

    fireEvent.mouseLeave(badge);
    fireEvent.pointerLeave(badge, { pointerType: "mouse" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: HOVER_WAIT_MS });
  });

  it("does not open on a touch pointer hover", async () => {
    const badge = renderBadge();
    fireEvent.pointerDown(badge, { pointerType: "touch" });
    fireEvent.pointerEnter(badge, { pointerType: "touch" });
    fireEvent.mouseEnter(badge);
    await new Promise((resolve) => setTimeout(resolve, HOVER_WAIT_MS / 2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens by press, as before", async () => {
    const badge = renderBadge();
    fireEvent.click(badge);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Status history" })).toBeTruthy());
  });
});
