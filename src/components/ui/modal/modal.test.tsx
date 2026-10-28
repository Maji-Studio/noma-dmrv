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
    expect(css).toBe('[data-overlay-layer="dialog"] [id="t-1"]{padding-inline-end:calc(var(--spacing-32) + var(--spacing-8))}');
  });

  it("pads titleId while the dialog keeps its aria-label", () => {
    render(
      <Modal isOpen onClose={() => {}} ariaLabel="Plain" titleId="t-2">
        <h2 id="t-2">Title</h2>
      </Modal>,
    );
    expect(document.querySelector("[data-overlay-layer='dialog'] style")?.textContent).toContain('[id="t-2"]');
    expect(document.querySelector("[data-overlay-layer='dialog']")?.getAttribute("aria-label")).toBe("Plain");
  });

  it("adds no rule when there is no title id", () => {
    render(
      <Modal isOpen onClose={() => {}} ariaLabel="Plain">
        <p>Body</p>
      </Modal>,
    );
    expect(document.querySelector("[data-overlay-layer='dialog'] style")).toBeNull();
  });
});
