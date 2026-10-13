import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IsometricFeedstockLink } from "./isometric-feedstock-link";

describe("IsometricFeedstockLink", () => {
  it("opens in a new tab without leaking the opener", () => {
    const html = renderToStaticMarkup(
      <IsometricFeedstockLink
        isometricFeedstockTypeId="ftt_1"
        isProduction
        name="Forestry waste"
      />,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://to.isometric.com/certify/ftt_1"');
  });

  it("uses the sandbox host when the org is on sandbox", () => {
    const html = renderToStaticMarkup(
      <IsometricFeedstockLink
        isometricFeedstockTypeId="ftt_1"
        isProduction={false}
        name="Forestry waste"
      />,
    );
    expect(html).toContain("registry.sandbox.isometric.com");
  });
});
