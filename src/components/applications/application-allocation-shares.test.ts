import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApplicationAllocationShares } from "./application-allocation-shares";

describe("application allocation display", () => {
  it("shows both batch dry amounts and percentages while retaining a shared run under each batch", () => {
    const html = renderToStaticMarkup(createElement(ApplicationAllocationShares, { shares: [
      { applicationId: "app", deliveryId: "delivery", biocharProductId: "A", productCode: "A", productionRunId: "shared", productionRunCode: "RUN", wetMassKg: 785.714, dryMassKg: 450 },
      { applicationId: "app", deliveryId: "delivery", biocharProductId: "B", productCode: "B", productionRunId: "shared", productionRunCode: "RUN", wetMassKg: 214.286, dryMassKg: 125 },
    ] }));
    expect(html).toContain("A: 450 kg dry · 78.261%");
    expect(html).toContain("B: 125 kg dry · 21.739%");
    expect(html).toContain("RUN: 450 kg dry");
    expect(html).toContain("RUN: 125 kg dry");
  });
});
