// @vitest-environment jsdom
import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRowActivationClick } from "./data-table-helpers";

afterEach(cleanup);

/** A clickable row like DataTable's, with a nested button and a portaled panel. */
function Row({ activate }: { activate: () => void }) {
  return (
    <div
      data-testid="row"
      onClick={(event) => handleRowActivationClick(event, activate)}
    >
      <span>Plain cell text</span>
      <button type="button">Row control</button>
      {createPortal(
        <div>
          <p>Portaled panel text</p>
          <span>Portaled text</span>
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
  it("activates on a click on plain row content", () => {
    const activate = setup();
    fireEvent.click(screen.getByText("Plain cell text"));
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("ignores presses that bubble in from a portal", () => {
    const activate = setup();
    // React bubbles both through the portal to the row's handlers.
    fireEvent.click(screen.getByText("Portaled panel text"));
    expect(activate).not.toHaveBeenCalled();
  });

  it("leaves a nested control's press to that control", () => {
    const activate = setup();
    fireEvent.click(screen.getByRole("button", { name: "Row control" }));
    expect(activate).not.toHaveBeenCalled();
  });
});
