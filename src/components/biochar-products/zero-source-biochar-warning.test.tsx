import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ZeroSourceBiocharWarning } from "./zero-source-biochar-warning";

describe("ZeroSourceBiocharWarning", () => {
  it("warns when a product contains zero source biochar", () => {
    const html = renderToStaticMarkup(
      <ZeroSourceBiocharWarning sourceBiocharMassKg={0} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("0 kg of source biochar");
    expect(html).toContain("cannot be ordered");
    expect(html).toContain("credit batch");
  });

  it("renders nothing for a positive source mass", () => {
    expect(
      renderToStaticMarkup(
        <ZeroSourceBiocharWarning sourceBiocharMassKg={1} />,
      ),
    ).toBe("");
  });
});
