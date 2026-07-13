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
  const pdf = await getDocument({
    data: new Uint8Array(pdfBytes),
    verbosity: 0,
  }).promise;
  return Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ");
    }),
  );
}

describe("renderEvidenceLedgerPdf", () => {
  it("keeps the method and distance-basis apparatus together in a multipage ledger", async () => {
    const model = buildLedgerModel({
      legsByCategory: {
        feedstock: Array.from({ length: MULTIPAGE_LEG_COUNT }, (_, index) =>
          leg(index + 1),
        ),
        biochar: [],
        sample: [],
      },
      memberBatchCodes: "CB-26-001",
      facilityName: "Dark Earth Hub",
      externalProjectId: "prj_TEST",
      generatedAtIso: "2026-07-13T00:00:00.000Z",
    });

    expect(model.categories[0].roundingAdjustmentTkm).not.toBeUndefined();
    const pages = await pageTexts(await renderEvidenceLedgerPdf(model));
    expect(pages.length).toBeGreaterThan(1);
    const extractedText = pages.join(" ").replace(/\s+/g, " ");
    expect(extractedText).toContain("D I S P L A Y E D R O W S U M");
    expect(extractedText).toContain("R O U N D I N G A D J U S T M E N T");

    const apparatusPage = pages.find(
      (text) =>
        text.includes("Each leg's contribution") &&
        text.includes("Routed estimate") &&
        text.includes("tonne·kilometre"),
    );
    expect(apparatusPage).toBeDefined();
  });
});
