import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetailField, DetailSpine } from "./index";

describe("DetailField certification status", () => {
  it("renders present saved values with the satisfied treatment", () => {
    const markup = renderToStaticMarkup(
      <DetailField label="Distance" value="25 km" certifyRequired />,
    );

    expect(markup).toContain("--st-ok-border");
  });

  it("renders absent saved values with the missing treatment", () => {
    const markup = renderToStaticMarkup(
      <DetailField label="Distance" value={null} certifyRequired />,
    );

    expect(markup).toContain("--st-wait-border");
  });

  it("accepts an explicit composite-requirement override", () => {
    const markup = renderToStaticMarkup(
      <DetailField
        label="Evidence"
        value="File attached"
        certifyRequired
        certifyStatus="missing"
      />,
    );

    expect(markup).toContain("--st-wait-border");
    expect(markup).not.toContain("--st-ok-border");
  });
});

describe("DetailSpine", () => {
  it("renders a contiguous passive step rail with shared spine chrome", () => {
    const markup = renderToStaticMarkup(
      <DetailSpine
        numbered
        sections={[
          { title: "First", fields: [{ label: "A", value: "One" }] },
          { title: "Second", fields: [{ label: "B", value: "Two" }] },
        ]}
      />,
    );

    expect(markup).toMatch(/>1<\/span>/);
    expect(markup).toMatch(/>2<\/span>/);
    expect(markup.match(/bottom-\[-16px\]/g)).toHaveLength(1);
    expect(markup).not.toContain("aria-checked");
  });

  it("preserves responsive detail rows and extension content", () => {
    const markup = renderToStaticMarkup(
      <DetailSpine
        numbered
        sections={[
          {
            title: "Details",
            fields: [
              { label: "A", value: "One" },
              { label: "B", value: "Two" },
              { label: "C", value: "Three" },
            ],
            content: <div>Extension content</div>,
          },
        ]}
      />,
    );

    expect(markup.match(/sm:flex-row/g)).toHaveLength(2);
    expect(markup).toContain("Extension content");
  });
});
