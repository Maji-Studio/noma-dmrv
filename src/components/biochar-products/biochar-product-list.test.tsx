import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { BiocharProductMassSummary } from "./biochar-product-list";

describe("BiocharProductMassSummary", () => {
  it("states the whole-facility scope and never says on this page", () => {
    const html = renderToStaticMarkup(
      <BiocharProductMassSummary
        stats={{ totalWetMassKg: 570, totalDryBiocharMassKg: 256.5 }}
      />,
    );

    expect(html).toContain("Total mass");
    expect(html).toContain("Across all products in this facility");
    expect(html).not.toContain("on this page");
    expect(html).toContain("570 kg");
    expect(html).toContain("256.5 kg");
  });

  it("keeps an incomplete dry-mass total explicit", () => {
    const html = renderToStaticMarkup(
      <BiocharProductMassSummary
        stats={{ totalWetMassKg: 150, totalDryBiocharMassKg: null }}
      />,
    );

    expect(html).toContain("150 kg");
    expect(html).toContain(MISSING_VALUE.notRecorded);
  });
});
