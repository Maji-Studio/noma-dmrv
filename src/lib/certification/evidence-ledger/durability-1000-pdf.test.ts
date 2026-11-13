import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderThousandYearDurabilityLedgerPdf } from "./durability-1000-pdf";
import { theme } from "./pdf-theme";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/storage-blueprints";

// The wordmark's right edge, in pt.
const PAGE_MARGIN = Number(theme.page.paddingHorizontal);
const WORDMARK_RIGHT = 80;
const GEOMETRY_TOLERANCE = 0.5;
// Distance from the page top (pt): the name lines end above the eyebrow,
// and the meta column ends above the claim band.
const MASTHEAD_NAME_BOTTOM = 66;
const META_COLUMN_BOTTOM = 160;

const buildModel = (organizationName: string) =>
    ({
      organizationName,
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
          componentLabel: "Current 1,000-year durability component",
          formulaVersion:
            "isometric-1000-year-organic-carbon-binomial-lower-bounded-v3",
          formulaLabel:
            "Organic-carbon binomial lower estimate bounded from 0 to 0.95",
          semanticsLabel:
            "Current organic-carbon basis with durability bounded from 0 to 0.95",
          rawMeanOrganicCarbonFraction: 0.7817,
          creditedMeanOrganicCarbonFraction: 0.7817,
          organicCarbonFloorApplied: false,
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
    }) satisfies Parameters<typeof renderThousandYearDurabilityLedgerPdf>[0];

describe("renderThousandYearDurabilityLedgerPdf", () => {
  it("renders the submitted replicate values and product mass into a readable PDF", async () => {
    const bytes = await renderThousandYearDurabilityLedgerPdf(
      buildModel("Example Carbon"),
    );

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
      expect(text.replace(/\s+/g, "")).toContain("dMRV·EXAMPLECARBON");
      expect(text.replace(/\s+/g, "")).not.toContain("DARKEARTHCARBON");
      expect(text).toContain("Durability Evidence Ledger");
      expect(text).toContain("CB-26-001");
      expect(text).toContain("400 kg product mass");
      expect(text).toContain("Current 1,000-year durability component");
      expect(text).toContain(CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR);
      expect(text).toContain(
        "isometric-1000-year-organic-carbon-binomial-lower-bounded-v3",
      );
      expect(text).toContain(
        "Organic-carbon binomial lower estimate bounded from 0 to 0.95",
      );
      expect(text).toContain(
        "organic-carbon basis with durability bounded from 0 to 0.95",
      );
      expect(text).toContain("Submitted directly measured dry-basis fraction");
      expect(text).toContain(
        "Raw row value is Total C minus Inorganic C; the credited aggregate mean is floored at zero",
      );
      expect(text).toContain("Raw mean organic carbon 0.7817");
      expect(text).toContain("Credited mean organic carbon 0.7817");
      expect(text).toContain("zero floor applied no");
      expect(text).toContain("Raw durability 1.000");
      expect(text).toContain("Capped durability 0.950");
      expect(text).toContain("0.010");
      expect(text).toContain("0.775");
      expect(text).toContain("0.790");
    } finally {
      await loadingTask.destroy();
    }
  });

  it("wraps a 100-character organization name inside the masthead's left column", async () => {
    const organizationName = "Northern Highlands Biochar and Regenerative Soil Carbon Removal Cooperative of Southern Tanzania Ltd".slice(0, 100);
    expect(organizationName).toHaveLength(100);
    const bytes = await renderThousandYearDurabilityLedgerPdf(
      buildModel(organizationName),
    );
    const loadingTask = getDocument({
      data: new Uint8Array(bytes),
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    try {
      const page = await pdf.getPage(1);
      const [, , pageWidth, pageHeight] = page.view;
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) =>
        "str" in item && item.str.trim() !== ""
          ? [
              {
                str: item.str.trim(),
                x: item.transform[4],
                right: item.transform[4] + item.width,
                fromTop: pageHeight - item.transform[5],
              },
            ]
          : [],
      );
      const squash = (value: string) => value.replace(/\s+/g, "");
      const expectedName = squash(`dMRV · ${organizationName.toUpperCase()}`);
      const mastheadItems = items.filter(
        (item) => item.fromTop < MASTHEAD_NAME_BOTTOM,
      );
      expect(squash(mastheadItems.map((item) => item.str).join(""))).toContain(
        expectedName,
      );

      // pdfjs reports the meta column word by word; these are the exact
      // strings of the four label/value pairs for this fixture.
      const metaStrings = new Set([
        "MEMBER", "BATCHES", "CB-26-001", "FACILITY", "Dark Earth Hub",
        "REGISTRY", "PROJECT", "prj_TEST", "EVIDENCE", "SET", "1",
        "batches ·", "3", "replicates",
      ]);
      const metaItems = items.filter(
        (item) => item.fromTop < META_COLUMN_BOTTOM && metaStrings.has(item.str),
      );
      expect(metaItems.length).toBeGreaterThanOrEqual(metaStrings.size);
      // Left edge of the meta column beside the name lines (the widest row,
      // "Evidence set", sits lower and is not next to them).
      const metaLeft = Math.min(
        ...metaItems
          .filter((item) => item.fromTop < MASTHEAD_NAME_BOTTOM)
          .map((item) => item.x),
      );
      for (const item of metaItems) {
        expect(item.right).toBeLessThanOrEqual(
          pageWidth - PAGE_MARGIN + GEOMETRY_TOLERANCE,
        );
      }

      // Everything else in the masthead's top band is the wordmark and the
      // wrapped name: none of it may reach the meta column.
      const nameItems = mastheadItems.filter(
        (item) => !metaStrings.has(item.str) && item.x > WORDMARK_RIGHT,
      );
      expect(nameItems.length).toBeGreaterThan(1);
      for (const item of nameItems) {
        expect(item.right).toBeLessThanOrEqual(metaLeft);
      }
      // It wrapped: more than one line of name items.
      expect(new Set(nameItems.map((item) => Math.round(item.fromTop))).size).toBeGreaterThan(1);
    } finally {
      await loadingTask.destroy();
    }
  });
});
