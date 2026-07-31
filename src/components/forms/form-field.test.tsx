import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormField } from "./form-field";

describe("FormField warning", () => {
  it("renders a non-blocking warning linked to the field", () => {
    const markup = renderToStaticMarkup(
      <FormField id="massKg" label="Mass" warning="Wet output exceeds wet input.">
        <input id="massKg" />
      </FormField>,
    );

    expect(markup).toContain('aria-describedby="massKg-warning"');
    expect(markup).toContain('id="massKg-warning"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Wet output exceeds wet input.");
    expect(markup).not.toContain('aria-invalid="true"');
  });

  it("shows a blocking error instead of the warning", () => {
    const markup = renderToStaticMarkup(
      <FormField
        id="massKg"
        label="Mass"
        error="Enter a valid mass."
        warning="Wet output exceeds wet input."
      >
        <input id="massKg" />
      </FormField>,
    );

    expect(markup).toContain('aria-describedby="massKg-error"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain("Enter a valid mass.");
    expect(markup).not.toContain("Wet output exceeds wet input.");
  });
});
