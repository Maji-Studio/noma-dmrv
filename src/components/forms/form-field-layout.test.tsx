import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormField } from "./form-field";

describe("FormField grid alignment", () => {
  it("exposes the shared hooks used to align labels and controls in form grids", () => {
    const html = renderToStaticMarkup(
      <div className="grid grid-cols-2">
        <FormField id="short" label="Short label">
          <input id="short" />
        </FormField>
        <FormField id="long" label="A label that wraps onto another line">
          <input id="long" />
        </FormField>
      </div>,
    );

    expect(html).toContain('class="form-field"');
    expect(html).toContain("form-field-label-row");

    const globalStyles = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    expect(globalStyles).toContain('@import "../styles/form-field-grid.css"');

    const formFieldGridStyles = readFileSync(
      join(process.cwd(), "src/styles/form-field-grid.css"),
      "utf8",
    );
    expect(formFieldGridStyles).toContain(".grid > .form-field");
    expect(formFieldGridStyles).toContain("grid-template-rows: subgrid");
  });
});
