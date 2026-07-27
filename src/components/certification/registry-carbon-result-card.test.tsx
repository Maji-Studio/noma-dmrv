import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegistryCarbonResultCard } from "./registry-carbon-result-card";

describe("RegistryCarbonResultCard", () => {
  it("renders only registry fields and no local carbon story", () => {
    const html = renderToStaticMarkup(
      <RegistryCarbonResultCard
        scopeLabel="Removal"
        data={{
          netRemovedKg: 900,
          netBeforeDiscountKg: 1000,
          standardDeviationKg: 12,
          riskOfReversalPercent: 10,
          bufferCreditsKg: 90,
          supplierCreditsKg: 810,
          registryStatementId: null,
          registryStatementStatus: null,
        }}
      />,
    );

    expect(html).toContain("Isometric registry result");
    expect(html).toContain("Net CO₂e removed");
    expect(html).not.toContain("Sequestrations");
    expect(html).not.toContain("Activities");
    expect(html).not.toContain("local estimate");
    expect(html).not.toContain("reconcile");
  });
});
