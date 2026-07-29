import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildGhgStatementReportModel } from "./model";
import { renderGhgStatementReportPdf } from "./pdf";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";

describe("renderGhgStatementReportPdf", () => {
  it("renders a valid, readable, nontrivial PDF", async () => {
    const semantic = { projectId: "prj_1" };
    const hash = payloadHash(semantic);
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
        standardVersion: "1.7",
        protocolVersion: "1.1.1",
      },
      authoritativeStatement: {
        externalRemovalIds: ["rmv_1"],
        pendingTotalCo2eRemovedKg: 900,
      },
      removalSnapshots: [
        {
          localRemovalId: "11111111-1111-4111-8111-111111111111",
          externalRemovalId: "rmv_1",
          submissionVersion: 2,
          payloadHash: hash,
          payloadSnapshot: {
            semantic,
            source_ids: ["src_1"],
          },
        },
      ],
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
        },
      ],
      narratives: {
        systemBoundaryAndMethodology:
          "The reviewer checked production, energy, transport, application, and storage boundaries.",
        evidenceIndex:
          "The reviewer checked the frozen Source bindings against the submitted Removal.",
        uncertaintyAndSensitivity:
          "The reviewer checked uncertainty inputs and sensitivity.",
        dataQualityAndExceptions:
          "The reviewer checked data quality, exclusions, incidents, and exceptions.",
        monitoringAndDurability:
          "The reviewer checked monitoring and durability evidence.",
        approvalStatement:
          "I reviewed the generated facts and qualitative statements.",
      },
    });

    const bytes = await renderGhgStatementReportPdf(model);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.subarray(-6).toString()).toContain("%%EOF");
    expect(bytes.byteLength).toBeGreaterThan(10_000);

    const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    const pdf = await task.promise;
    try {
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/\s+/g, " ");
      expect(text).toContain("GHG Statement Report");
      expect(text).toContain("rmv_1");
      expect(text).toContain(hash);
      expect(text.toLowerCase()).toContain("energy");
      expect(text.toLowerCase()).toContain("transport");
    } finally {
      await task.destroy();
    }
  });
});
