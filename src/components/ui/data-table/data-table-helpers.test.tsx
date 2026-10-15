// @vitest-environment jsdom
import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRowActivationClick, handleRowActivationKeyDown } from "./data-table-helpers";

afterEach(cleanup);

/** A clickable row like DataTable's, with a nested button and a portaled panel. */
function Row({ activate }: { activate: () => void }) {
  return (
    <div
      data-testid="row"
      tabIndex={0}
      onClick={(event) => handleRowActivationClick(event, activate)}
      onKeyDown={(event) => handleRowActivationKeyDown(event, activate)}
    >
      <span>Plain cell text</span>
      <button type="button">Row control</button>
      {createPortal(
        <div>
          <p>Portaled panel text</p>
          <span tabIndex={0}>Portaled focusable</span>
        </div>,
        document.body,
      )}
    </div>
  );
}

function setup() {
  const activate = vi.fn();
  render(<Row activate={activate} />);
  return activate;
}

describe("row activation", () => {
  it("activates on a click or Enter on plain row content", () => {
    const activate = setup();
    fireEvent.click(screen.getByText("Plain cell text"));
    fireEvent.keyDown(screen.getByTestId("row"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("row"), { key: " " });
    expect(activate).toHaveBeenCalledTimes(3);
  });

  it("ignores presses that bubble in from a portal", () => {
    const activate = setup();
    // React bubbles both through the portal to the row's handlers.
    fireEvent.click(screen.getByText("Portaled panel text"));
    fireEvent.keyDown(screen.getByText("Portaled focusable"), { key: "Enter" });
    expect(activate).not.toHaveBeenCalled();
  });

  it("leaves a nested control's press to that control", () => {
    const activate = setup();
    fireEvent.click(screen.getByRole("button", { name: "Row control" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Row control" }), { key: "Enter" });
    expect(activate).not.toHaveBeenCalled();
  });

  it("ignores keys other than Enter and Space", () => {
    const activate = setup();
    fireEvent.keyDown(screen.getByTestId("row"), { key: "Escape" });
    expect(activate).not.toHaveBeenCalled();
  });
});
