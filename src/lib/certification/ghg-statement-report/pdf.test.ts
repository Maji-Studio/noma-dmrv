import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildGhgStatementReportModel } from "./model";
import { renderGhgStatementReportPdf } from "./pdf";

describe("renderGhgStatementReportPdf", () => {
  it("renders a readable fact-only GHG Statement summary", async () => {
    const model = buildGhgStatementReportModel({
      reportVersion: 3,
      preparedAt: "2026-07-28T12:00:00.000Z",
      documentControl: {
        organizationName: "Test supplier",
        facilityCode: "FAC-01",
        externalProjectId: "prj_1",
        externalGhgStatementId: "ggs_1",
        reportingPeriodStartOn: "2026-07-01",
        reportingPeriodEndOn: "2026-07-31",
        protocolVersion: "1.1",
      },
      authoritativeStatement: {
        externalEntryIds: ["rmv_1"],
        pendingTotalCo2eRemovedKg: 900,
      },
      remoteEntries: [
        {
          id: "rmv_1",
          startedOn: "2026-07-01",
          completedOn: "2026-07-31",
          netRemovedKg: 900,
          netRemovedWithoutDiscountKg: 950,
          netRemovedStandardDeviationKg: 4,
          supplierCreditKg: 880,
          bufferPoolKg: 20,
          ghgStatementId: "ggs_1",
        },
      ],
    });

    const bytes = await renderGhgStatementReportPdf(model);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.subarray(-6).toString()).toContain("%%EOF");
    expect(bytes.byteLength).toBeGreaterThan(8_000);

    const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    const pdf = await task.promise;
    try {
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, index) => {
          const page = await pdf.getPage(index + 1);
          const content = await page.getTextContent();
          return content.items
            .flatMap((item) => ("str" in item ? [item.str] : []))
            .join(" ");
        }),
      );
      const text = pages.join(" ").replace(/\s+/g, " ");

      expect(text).toContain("GHG Statement Data Summary");
      expect(text).toContain("prj_1");
      expect(text).toContain("ggs_1");
      expect(text).toContain("rmv_1");
      expect(text).toContain("2026-07-01 to 2026-07-31");
      expect(text).toContain(model.sourceFingerprint);
      expect(text).toContain("Registry data reconciliation only");
      expect(text).not.toContain("Methodology and reviewed narrative");
      expect(text).not.toContain("Review acknowledgment");
      expect(text).not.toContain("Human reviewed");
    } finally {
      await task.destroy();
    }
  });
});
