import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TimezoneCombobox } from "./timezone-combobox";

const baseProps = {
  id: "timezone",
  name: "timezone",
  inputRef: vi.fn(),
  onChange: vi.fn(),
  onBlur: vi.fn(),
};

describe("TimezoneCombobox", () => {
  it("starts empty with the select placeholder when nothing is chosen", () => {
    const html = renderToStaticMarkup(<TimezoneCombobox {...baseProps} />);

    expect(html).toContain('placeholder="Select timezone"');
    expect(html).not.toContain('value="UTC');
  });

  it("shows the chosen zone", () => {
    const html = renderToStaticMarkup(
      <TimezoneCombobox {...baseProps} value="Africa/Dar_es_Salaam" />,
    );

    expect(html).toContain("Africa/Dar es Salaam (UTC+3)");
  });

  it("shows a stored alias as selected", () => {
    const html = renderToStaticMarkup(
      <TimezoneCombobox {...baseProps} value="Australia/Melbourne" />,
    );

    expect(html).toContain("Australia/Sydney");
  });
});

describe("TimezoneCombobox required", () => {
  it("is natively required by default and can be made optional", () => {
    const required = renderToStaticMarkup(<TimezoneCombobox {...baseProps} />);
    const optional = renderToStaticMarkup(
      <TimezoneCombobox {...baseProps} required={false} />,
    );

    expect(required).toContain('required=""');
    expect(optional).not.toContain('required=""');
  });
});
