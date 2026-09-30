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

describe("FormField help: cue and ⓘ", () => {
  it("sends helperText to the ⓘ however short it is, never as a visible line", () => {
    const markup = renderToStaticMarkup(
      <FormField id="notes" label="Notes" helperText="Seeds new orders.">
        <input id="notes" />
      </FormField>,
    );

    // Screen-reader copy, linked from the control and from the ⓘ trigger.
    expect(markup).toContain('<span id="notes-helper" class="sr-only">Seeds new orders.</span>');
    expect(markup).toContain('aria-describedby="notes-helper"');
    expect(markup).toContain('aria-label="More about Notes"');
    expect(markup).not.toContain('id="notes-cue"');
    expect(markup).not.toContain("body-caption text-[var(--color-text-tertiary)]\">Seeds new orders.");
  });

  it("shows a cue as one visible line under the control, before the explanation", () => {
    const markup = renderToStaticMarkup(
      <FormField id="moisture" label="Moisture" cue="0 to 100% of wet mass" hint="Wet basis.">
        <input id="moisture" />
      </FormField>,
    );

    expect(markup).toContain('<p id="moisture-cue" class="body-caption text-[var(--color-text-tertiary)]">0 to 100% of wet mass</p>');
    expect(markup).toContain('aria-describedby="moisture-cue moisture-helper"');
  });

  it("lets an error replace the cue", () => {
    const markup = renderToStaticMarkup(
      <FormField id="moisture" label="Moisture" cue="0 to 100% of wet mass" error="Enter less than 100%.">
        <input id="moisture" />
      </FormField>,
    );

    expect(markup).not.toContain("0 to 100% of wet mass");
    expect(markup).toContain('aria-describedby="moisture-error"');
  });

  it("keeps the ⓘ trigger outside the label so a tap never reaches the control", () => {
    const markup = renderToStaticMarkup(
      <FormField id="mass" label="Mass" hint="As-received weight.">
        <input id="mass" />
      </FormField>,
    );

    const label = markup.slice(markup.indexOf("<label"), markup.indexOf("</label>"));
    expect(label).not.toContain("<button");
    expect(markup).toContain("data-toggletip-trigger");
    expect(markup).toContain("min-w-24 min-h-24");
  });
});

describe("FormField unit suffix", () => {
  it("shows the unit inside the control and keeps it in the accessible name", () => {
    const markup = renderToStaticMarkup(
      <FormField id="mass" label="Mass" unit="kg">
        <input id="mass" />
      </FormField>,
    );

    expect(markup).toContain('Mass<span class="sr-only"> (kg)</span></label>');
    expect(markup).toContain('data-control-unit=""');
    expect(markup).toContain(">kg</span>");
    expect(markup).toContain("padding-inline-end:calc(2ch + var(--spacing-24))");
  });
});

describe("FormField certification seal", () => {
  it("renders the seal on the label row and describes the control with it", () => {
    const markup = renderToStaticMarkup(
      <FormField id="distance" label="Distance" certifyRequired certifyStatus="missing">
        <input id="distance" />
      </FormField>,
    );

    expect(markup).toContain('data-cert-field="missing"');
    expect(markup).toContain('<span id="distance-cert" class="sr-only">Required for certification. Not provided.</span>');
    expect(markup).toContain('aria-describedby="distance-cert"');
    expect(markup).not.toContain(">CERT<");
  });
});
