// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./modal";

afterEach(cleanup);

describe("Modal title clearance", () => {
  it("reserves the close button's width on the labelled heading", () => {
    render(
      <Modal isOpen onClose={() => {}} ariaLabelledBy="t-1">
        <h2 id="t-1">A very long title</h2>
      </Modal>,
    );
    const css = document.querySelector("[data-overlay-layer='dialog'] style")?.textContent ?? "";
    expect(css).toBe('[id="t-1"]{padding-inline-end:calc(var(--spacing-32) + var(--spacing-8))}');
  });

  it("adds no rule when the dialog is named by aria-label only", () => {
    render(
      <Modal isOpen onClose={() => {}} ariaLabel="Plain">
        <p>Body</p>
      </Modal>,
    );
    expect(document.querySelector("[data-overlay-layer='dialog'] style")).toBeNull();
  });
});
