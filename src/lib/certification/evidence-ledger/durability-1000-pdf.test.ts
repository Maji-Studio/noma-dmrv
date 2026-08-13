import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderThousandYearDurabilityLedgerPdf } from "./durability-1000-pdf";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/transformers/measurement-sample";

describe("renderThousandYearDurabilityLedgerPdf", () => {
  it("renders the submitted replicate values and product mass into a readable PDF", async () => {
    const bytes = await renderThousandYearDurabilityLedgerPdf({
      memberBatchCodes: "CB-26-001",
      facilityName: "Dark Earth Hub",
      externalProjectId: "prj_TEST",
      generatedAtIso: "2026-07-28T00:00:00.000Z",
      totalReplicates: 3,
      batches: [
        {
          creditBatchId: "batch-1",
          creditBatchCode: "CB-26-001",
          replicateCount: 3,
          productMassKg: 400,
          componentKey: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
          formulaVersion:
            "isometric-1000-year-organic-carbon-binomial-lower-cap-v1",
          semanticsLabel: "Current organic-carbon basis with 0.95 durability cap",
          rawDurability: 1,
          cappedDurability: 0.95,
          capApplied: true,
          replicates: [
            {
              ref: "R1",
              sampleCode: "S-001",
              samplingDay: "2026-07-26",
              labName: "Test lab",
              totalCarbonFraction: 0.8,
              inorganicCarbonFraction: 0.01,
              calculatedOrganicCarbonFraction: 0.79,
              sFraction: 1,
            },
            {
              ref: "R2",
              sampleCode: "S-002",
              samplingDay: "2026-07-26",
              labName: "Test lab",
              totalCarbonFraction: 0.8,
              inorganicCarbonFraction: 0.02,
              calculatedOrganicCarbonFraction: 0.78,
              sFraction: 1,
            },
            {
              ref: "R3",
              sampleCode: "S-003",
              samplingDay: "2026-07-27",
              labName: "Test lab",
              totalCarbonFraction: 0.79,
              inorganicCarbonFraction: 0.015,
              calculatedOrganicCarbonFraction: 0.775,
              sFraction: 1,
            },
          ],
        },
      ],
    });

    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const loadingTask = getDocument({
      data: new Uint8Array(bytes),
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    try {
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/\s+/g, " ");
      expect(text).toContain("Durability Evidence Ledger");
      expect(text).toContain("CB-26-001");
      expect(text).toContain("400 kg product mass");
      expect(text).toContain(CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR);
      expect(text).toContain("organic-carbon basis with 0.95 durability cap");
      expect(text).toContain("Submitted directly measured dry-basis fraction");
      expect(text).toContain("Calculated row by row as Total C minus Inorganic C");
      expect(text).toContain("Raw durability 1.000");
      expect(text).toContain("Capped durability 0.950");
      expect(text).toContain("0.010");
      expect(text).toContain("0.775");
      expect(text).toContain("0.790");
    } finally {
      await loadingTask.destroy();
    }
  });
});
