// @vitest-environment jsdom
/**
 * The FormActions submit skips the browser's constraint bubbles so the
 * schema's messages explain a refusal, except while a number input holds text
 * the browser cannot parse, which would otherwise submit as a cleared value.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormActions } from "./form-actions";

afterEach(cleanup);

function renderForm(onSubmitClick?: () => void) {
  render(
    <form aria-label="Sample">
      <input aria-label="pH" type="number" min="0" max="14" defaultValue="20" />
      <FormActions submitLabel="Save record" onSubmitClick={onSubmitClick} />
    </form>,
  );
  return {
    input: screen.getByLabelText("pH") as HTMLInputElement,
    submit: screen.getByRole("button", { name: "Save record" }) as HTMLButtonElement,
  };
}

function markUnparsed(input: HTMLInputElement) {
  Object.defineProperty(input, "validity", { value: { ...input.validity, badInput: true } });
}

describe("FormActions native checks", () => {
  it("skips the browser bubble for an out-of-range number", () => {
    const { submit } = renderForm();

    fireEvent.click(submit);

    expect(submit.formNoValidate).toBe(true);
  });

  it("keeps the browser check while a number input holds unparsed text", () => {
    const { input, submit } = renderForm();
    markUnparsed(input);

    fireEvent.click(submit);

    expect(submit.formNoValidate).toBe(false);
  });

  it("still calls the caller's click handler", () => {
    const onSubmitClick = vi.fn();
    const { submit } = renderForm(onSubmitClick);

    fireEvent.click(submit);

    expect(onSubmitClick).toHaveBeenCalledOnce();
  });
});
