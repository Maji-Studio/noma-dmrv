import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormActions } from "./form-actions";

describe("FormActions", () => {
  it("renders an action error inside the sticky footer immediately above the buttons", () => {
    const markup = renderToStaticMarkup(
      <FormActions errorMessage="Action failed" submitLabel="Save record" />,
    );

    const stickyFooterIndex = markup.indexOf("sticky bottom-0");
    const alertIndex = markup.indexOf('role="alert"');
    const buttonRowIndex = markup.indexOf(
      'class="flex items-center justify-start gap-16"',
    );

    expect(stickyFooterIndex).toBeGreaterThanOrEqual(0);
    expect(alertIndex).toBeGreaterThan(stickyFooterIndex);
    expect(buttonRowIndex).toBeGreaterThan(alertIndex);
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(markup).toContain("Action failed");
  });

  it("does not render an alert without an action error", () => {
    const markup = renderToStaticMarkup(<FormActions submitLabel="Save record" />);

    expect(markup).not.toContain('role="alert"');
  });
});
