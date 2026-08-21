import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RemovalCompilationView } from "@/fn/certification";
import { RemovalEmissionsLedger } from "./removal-emissions-ledger";

describe("RemovalEmissionsLedger", () => {
  it("explains the estimate once and links a previous production claim", () => {
    const compilation = {
      estimatedStoredCo2eTonnes: 12.34,
    } satisfies Pick<RemovalCompilationView, "estimatedStoredCo2eTonnes">;

    const html = renderToStaticMarkup(
      <RemovalEmissionsLedger
        compilation={compilation as RemovalCompilationView}
        ledger={{
          inputs: [{
            id: "biochar-transport",
            component: "Biochar transport",
            input: "Mass and distance",
            magnitude: 42,
            unit: "t·km",
          }],
          inputsUnavailable: false,
          creditBatches: [{ id: "batch-1", code: "CB-001" }],
          productionRuns: [{ id: "run-1", code: "PR-001" }],
          applications: [{
            id: "application-1",
            code: "AP-001",
            deliveryCode: "DL-001",
            creditBatchIds: ["batch-1"],
          }],
          claims: [
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

  it("explains when numeric inputs are unavailable", () => {
    const html = renderToStaticMarkup(
      <RemovalEmissionsLedger
        compilation={{ estimatedStoredCo2eTonnes: null } as RemovalCompilationView}
        ledger={{
          inputs: [],
          inputsUnavailable: true,
          creditBatches: [],
          productionRuns: [],
          applications: [],
          claims: [],
        }}
        facilityId="facility-1"
        isLoading={false}
      />,
    );

    expect(html).toContain("Not available");
    expect(html).toContain("Complete the source data checks");
    expect(html).not.toContain("<table");
  });
});
