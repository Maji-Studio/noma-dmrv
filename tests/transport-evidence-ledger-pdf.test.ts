import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TransportLeg } from "@/db/schema";
import { buildLedgerModel } from "@/lib/certification/evidence-ledger/build-model";
import { renderEvidenceLedgerPdf } from "@/lib/certification/evidence-ledger/pdf";

const MULTIPAGE_LEG_COUNT = 28;

function leg(index: number): TransportLeg {
  return {
    id: `leg-${index}`,
    entityType: "feedstock",
    entityId: `feedstock-${index}`,
    originName: `Supplier ${index}`,
    originGpsLatitude: -3.286,
    originGpsLongitude: 37.157,
    destinationName: "Facility",
    destinationGpsLatitude: -3.348,
    destinationGpsLongitude: 37.34,
    distanceKm: 1,
    distanceSource: "map_estimate",
    transportMethodType: "road",
    vehicleType: "Heavy truck",
    modelYear: null,
    loadMassKg: 5,
    tripType: "one_way",
    calculationMethodType: "distance_based",
    isDerived: false,
  } as unknown as TransportLeg;
}

async function pageTexts(pdfBytes: Buffer): Promise<string[]> {
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBytes),
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  try {
    return await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items
          .flatMap((item) => ("str" in item ? [item.str] : []))
          .join(" ");
      }),
    );
  } finally {
    await loadingTask.destroy();
  }
}

describe("renderEvidenceLedgerPdf", () => {
  it("keeps the method and distance-basis apparatus together in a multipage ledger", async () => {
    const model = buildLedgerModel({
      legsByCategory: {
        feedstock: Array.from({ length: MULTIPAGE_LEG_COUNT }, (_, index) =>
          leg(index + 1),
        ),
        biochar: [
          {
            ...leg(100),
            entityType: "biochar",
            distanceKm: 10.005,
            loadMassKg: 1000,
          },
        ],
        sample: [],
      },
      memberBatchCodes: "CB-26-001",
      facilityName: "Dark Earth Hub",
      externalProjectId: "prj_TEST",
      generatedAtIso: "2026-07-13T00:00:00.000Z",
      appliedBiocharFraction: 0.5,
    });

    expect(model.categories[0].roundingAdjustmentTkm).not.toBeUndefined();
    const pages = await pageTexts(await renderEvidenceLedgerPdf(model));
    expect(pages.length).toBeGreaterThan(1);
    const extractedText = pages.join(" ").replace(/\s+/g, " ");
    const compactText = extractedText.replace(/\s+/g, "");
    expect(compactText).toContain("DISPLAYEDROWSUM");
    expect(compactText).toContain("ROUNDINGADJUSTMENT");
    expect(compactText).toContain("SCALINGADJUSTMENT");

    const apparatusPage = pages.find(
      (text) =>
        text.includes("Each leg's contribution") &&
        text.includes("Routed estimate") &&
        text.includes("tonne·kilometre"),
    );
    expect(apparatusPage).toBeDefined();
  });
});
