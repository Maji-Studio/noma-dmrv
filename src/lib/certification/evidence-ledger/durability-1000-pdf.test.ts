import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderThousandYearDurabilityLedgerPdf } from "./durability-1000-pdf";

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
          replicates: [
            {
              ref: "R1",
              sampleCode: "S-001",
              samplingDay: "2026-07-26",
              labName: "Test lab",
              carbonContentFraction: 0.8,
              sFraction: 0.98,
            },
            {
              ref: "R2",
              sampleCode: "S-002",
              samplingDay: "2026-07-26",
              labName: "Test lab",
              carbonContentFraction: 0.8,
              sFraction: 0.97,
            },
            {
              ref: "R3",
              sampleCode: "S-003",
              samplingDay: "2026-07-27",
              labName: "Test lab",
              carbonContentFraction: 0.79,
              sFraction: 0.91,
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
      expect(text).toContain("0.980");
      expect(text).toContain("0.790");
    } finally {
      await loadingTask.destroy();
    }
  });
});
