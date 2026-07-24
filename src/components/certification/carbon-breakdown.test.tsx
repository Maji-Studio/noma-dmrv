import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  computeRemovalBreakdown,
  type RemovalBreakdownAnomaly,
  type RemovalCarbonBreakdown,
} from "@/lib/certification/removal-breakdown";
import {
  CarbonBreakdownCard,
  type CarbonBreakdownLabels,
} from "./carbon-breakdown";

const LABELS: CarbonBreakdownLabels = {
  noData: "No data.",
  estimateIncomplete: "Estimate incomplete.",
  estimateFootnote: "Verification sets the final net.",
};

function breakdown(
  overrides: Partial<RemovalCarbonBreakdown> = {},
): RemovalCarbonBreakdown {
  return {
    source: "registry",
    sequestrationKg: 1040,
    sequestrationComplete: true,
    activitiesKg: 741,
    activitiesRecorded: true,
    counterfactualKg: 0,
    counterfactualRecorded: false,
    localNetBeforeDiscountKg: 299,
    netBeforeDiscountKg: 299,
    uncertaintyDiscountKg: 15,
    standardDeviationKg: 15,
    netRemovedKg: 284,
    bufferPoolPercent: 12,
    bufferCreditsKg: 34,
    supplierCreditsKg: 250,
    reconciles: true,
    missingInputs: [],
    memberBatchCount: 2,
    hasAnyData: true,
    anomalies: [],
    registryVerification: {
      ghgStatementId: "ghg_123",
      ghgStatementStatus: "VERIFIED",
    },
    ...overrides,
  };
}

function render(data: RemovalCarbonBreakdown): string {
  return renderToStaticMarkup(
    <CarbonBreakdownCard data={data} labels={LABELS} />,
  );
}

function estimateBreakdown({
  sequestrationTonnesByBatch,
  emissionsTonnesByBatch,
  counterfactualTonnesByBatch = [],
}: {
  sequestrationTonnesByBatch: (number | null)[];
  emissionsTonnesByBatch: (number | null)[];
  counterfactualTonnesByBatch?: (number | null)[];
}): RemovalCarbonBreakdown {
  return computeRemovalBreakdown({
    sequestrationTonnesByBatch,
    emissionsTonnesByBatch,
    counterfactualTonnesByBatch,
    missingInputs: [],
    memberBatchCount: sequestrationTonnesByBatch.length,
    registry: null,
  });
}

describe("CarbonBreakdownCard", () => {
  it("renders the no-data state for an empty estimate", () => {
    const data = estimateBreakdown({
      sequestrationTonnesByBatch: [],
      emissionsTonnesByBatch: [],
    });
    const html = render(data);

    expect(data.anomalies).toEqual([]);
    expect(html).toContain(LABELS.noData);
    expect(html).not.toContain('role="alert"');
  });

  it("renders the incomplete state when an estimate has other data", () => {
    const data = estimateBreakdown({
      sequestrationTonnesByBatch: [null],
      emissionsTonnesByBatch: [0.1],
    });
    const html = render(data);

    expect(data.anomalies).toEqual([]);
    expect(html).toContain(LABELS.estimateIncomplete);
    expect(html).not.toContain('role="alert"');
  });

  it("renders the estimate-specific anomaly for a negative local net", () => {
    const data = estimateBreakdown({
      sequestrationTonnesByBatch: [0.1],
      emissionsTonnesByBatch: [0.2],
    });
    const html = render(data);

    expect(data.anomalies).toEqual(["net-negative"]);
    expect(html).toContain('role="alert"');
    expect(html).toContain("The carbon estimate reports net emissions.");
    expect(html).not.toContain("Registry reports net emissions");
  });

  it("preserves the sign of a net-negative registry figure", () => {
    const html = render(
      breakdown({
        netRemovedKg: -335.16,
        anomalies: ["net-negative"],
      }),
    );

    expect(html).toContain("−335 kg CO₂e");
    expect(html).not.toContain(">335 kg CO₂e<");
  });

  it("applies ledger signs exactly once", () => {
    const html = render(breakdown());

    expect(html).toContain("+1.04 t CO₂e");
    expect(html).toContain("−741 kg CO₂e");
    expect(html).toContain("−15 kg CO₂e");
    expect(html).not.toContain("− −");
  });

  it.each([
    ["net-negative", "Registry reports net emissions"],
    [
      "net-exceeds-before-discount",
      "Registry net exceeds the amount before uncertainty discount",
    ],
    [
      "sequestration-missing-or-zero",
      "Sequestration inputs are missing or contribute no stored CO₂e",
    ],
  ] as const)("renders a destructive failure for %s", (anomaly, copy) => {
    const html = render(
      breakdown({ anomalies: [anomaly as RemovalBreakdownAnomaly] }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("--st-bad");
    expect(html).toContain(copy);
    expect(html).not.toContain("Uncertainty discount");
  });

  it.each([
    [null, null],
    ["ghg_123", "DRAFT"],
    ["ghg_123", "AWAITING_VERIFICATION"],
  ] as const)(
    "labels registry figures with statement %s / status %s as unverified",
    (ghgStatementId, ghgStatementStatus) => {
      const html = render(
        breakdown({
          registryVerification: {
            ghgStatementId,
            ghgStatementStatus,
          },
        }),
      );

      expect(html).toContain("Registry draft — unverified");
      expect(html).not.toContain("Registry-verified");
    },
  );

  it.each(["VERIFIED", "CREDITS_ISSUED"] as const)(
    "labels a registry entry linked to a %s statement as verified",
    (ghgStatementStatus) => {
      const html = render(
        breakdown({
          registryVerification: {
            ghgStatementId: "ghg_123",
            ghgStatementStatus,
          },
        }),
      );

      expect(html).toContain("Registry-verified");
    },
  );

  it("labels local figures as an estimate", () => {
    const html = render(
      breakdown({
        source: "estimate",
        uncertaintyDiscountKg: null,
        standardDeviationKg: null,
        registryVerification: null,
      }),
    );

    expect(html).toContain("Estimate");
    expect(html).not.toContain("Registry-verified");
  });
});
