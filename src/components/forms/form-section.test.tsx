import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormSection } from "./form-section";

describe("FormSection headingless groups", () => {
  it("omits the heading row and keeps the normal section divider", () => {
    const markup = renderToStaticMarkup(<FormSection><span>Description</span></FormSection>);
    expect(markup).not.toContain("<h3");
    expect(markup).toContain("border-t");
    expect(markup).toContain("pt-16");
    expect(markup).toContain("Description");
  });

  it("starts with the fields when the first section has no divider", () => {
    const markup = renderToStaticMarkup(<FormSection divider={false}><span>Name</span></FormSection>);
    expect(markup).not.toContain("<h3");
    expect(markup).not.toContain("border-t");
    expect(markup).not.toContain("pt-16");
    expect(markup).toContain("Name");
  });

  it("keeps header actions without creating an empty heading", () => {
    const markup = renderToStaticMarkup(
      <FormSection actions={<button type="button">Add ingredient</button>}><span>Fields</span></FormSection>,
    );
    expect(markup).not.toContain("<h3");
    expect(markup).toContain("Add ingredient");
    expect(markup.indexOf("Add ingredient")).toBeLessThan(markup.indexOf("Fields"));
  });
});
