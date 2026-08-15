import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RemovalCompilationView } from "@/fn/certification";
import { RemovalEmissionsLedger } from "./removal-emissions-ledger";

describe("RemovalEmissionsLedger", () => {
  it("explains the estimate once and links a previous production claim", () => {
    const compilation = {
      estimatedStoredCo2eTonnes: 12.34,
      estimateMissingInputs: [],
      review: {
        bindings: [{
          componentId: "component-1",
          componentDisplayName: "Biochar transport",
          inputKey: "mass_distance",
          binding: "monitored",
          wireMagnitude: 42,
          wireUnit: "t.km",
        }],
        memberCreditBatches: [{ id: "batch-1", code: "CB-001" }],
        productionRuns: [{ id: "run-1", code: "PR-001" }],
        applications: [{
          id: "application-1",
          code: "AP-001",
          deliveryId: "delivery-1",
          deliveryCode: "DL-001",
        }],
        productionEmissionClaims: [
          {
            creditBatchId: "batch-1",
            creditBatchCode: "CB-001",
            claimingRemovalId: "removal-previous",
            contribution: "delivery-only",
          },
          {
            creditBatchId: "batch-2",
            creditBatchCode: "CB-002",
            claimingRemovalId: null,
            contribution: "production-and-delivery",
          },
        ],
      },
    } as unknown as RemovalCompilationView;

    const html = renderToStaticMarkup(
      <RemovalEmissionsLedger
        compilation={compilation}
        ledger={{
          inputs: [{
            id: "biochar-transport",
            component: "Biochar transport",
            input: "Mass and distance",
            magnitude: 42,
            unit: "t·km",
          }],
          creditBatches: [{ id: "batch-1", code: "CB-001" }],
          productionRuns: [{ id: "run-1", code: "PR-001" }],
          applications: [{
            id: "application-1",
            code: "AP-001",
            deliveryCode: "DL-001",
          }],
          claims: compilation.review.productionEmissionClaims ?? [],
        }}
        facilityId="facility-1"
        isLoading={false}
      />,
    );

    expect(html).toContain("≈ 12.34 t CO₂e");
    expect(html.match(/Estimated CO₂e/g)).toHaveLength(1);
    expect(html).toContain("Previously included in Removal removal-…");
    expect(html).toContain("Mass and distance");
    expect(html).toContain("AP-001");
    expect(html).toContain("Emission allocation");
  });
});
