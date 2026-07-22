import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntitySideSheetSections } from "./index";

const sections = [
  { title: "Overview", fields: [{ label: "Code", value: "ABC-001" }] },
  { title: "Details", fields: [{ label: "Status", value: "Ready" }] },
];

describe("EntitySideSheetSections", () => {
  it("keeps generic read sections unnumbered by default", () => {
    const markup = renderToStaticMarkup(
      <EntitySideSheetSections sections={sections} />,
    );

    expect(markup).not.toMatch(/>1<\/span>/);
    expect(markup).not.toMatch(/>2<\/span>/);
  });

  it("mirrors FormSpine numbering only when explicitly requested", () => {
    const markup = renderToStaticMarkup(
      <EntitySideSheetSections sections={sections} numbered />,
    );

    expect(markup).toMatch(/>1<\/span>/);
    expect(markup).toMatch(/>2<\/span>/);
  });
});
