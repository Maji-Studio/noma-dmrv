import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApplicationAllocationShares } from "./application-allocation-shares";

describe("application allocation display", () => {
  it("totals each batch in the ledger and keeps the shared run behind the calculation", () => {
    const html = renderToStaticMarkup(createElement(ApplicationAllocationShares, { shares: [
      { applicationId: "app", deliveryId: "delivery", biocharProductId: "A", productCode: "A", productionRunId: "shared", productionRunCode: "RUN", wetMassKg: 785.714, dryMassKg: 450 },
      { applicationId: "app", deliveryId: "delivery", biocharProductId: "B", productCode: "B", productionRunId: "shared", productionRunCode: "RUN", wetMassKg: 214.286, dryMassKg: 125 },
    ] }));
    // Batch totals and shares live in the always-visible ledger.
    expect(html).toContain("450 kg");
    expect(html).toContain("125 kg");
    expect(html).toContain("78.3%");
    expect(html).toContain("21.7%");
    // The disclosure adds only the source runs behind each batch.
    expect(html).toContain('aria-label="Source production runs per applied batch"');
    expect(html).toContain("RUN");
    expect(html).not.toContain(" · ");
  });
});
