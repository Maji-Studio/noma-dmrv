import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetailField } from "./index";

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
