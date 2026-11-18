import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildDurabilityLedgerModel } from "@/lib/certification/evidence-ledger/durability-build-model";
import { buildThousandYearDurabilityLedgerModel } from "@/lib/certification/evidence-ledger/durability-1000-build-model";
import { renderDurabilityLedgerPdf } from "@/lib/certification/evidence-ledger/durability-pdf";
import { renderThousandYearDurabilityLedgerPdf } from "@/lib/certification/evidence-ledger/durability-1000-pdf";
import type { Sample } from "@/db/schema";

const common = {
  organizationName: "Example Carbon",
  memberBatchCodes: "CB-1",
  facilityName: "Example facility",
  externalProjectId: "prj-test",
  generatedAtIso: "2026-01-31T00:00:00.000Z",
  attributionByRunId: new Map<string, number>(),
  batches: [{
    creditBatchId: "batch-1", creditBatchCode: "CB-1",
    runs: [{ id: "run-1", biocharDryMassKg: 100 }],
    samples: [{
      id: "sample-1", sampleCode: "S-1", samplingTime: new Date("2026-01-01"),
      labName: "Lab", hToCOrgRatio: 0.3, oToCOrgRatio: 0.1,
      totalCarbonPercent: 80, inorganicCarbonPercent: 1, organicCarbonPercent: 79,
      sReflectanceFraction: 0.9,
    } as Sample],
  }],
};

async function textOf(bytes: Buffer) {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const texts = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const content = await (await pdf.getPage(index + 1)).getTextContent();
      return content.items.flatMap(item => "str" in item ? [item.str] : []).join("");
    }));
    return texts.join("").replace(/\s+/g, "");
  } finally {
    await task.destroy();
  }
}

describe("organization names in durability PDF headers", () => {
  it.each(["Example Carbon", "Another Operator"])("uses %s for both durability tiers", async (organizationName) => {
    const args = { ...common, organizationName };
    const twoHundred = buildDurabilityLedgerModel({
      ...args,
      facilityReferenceSoilTemperature: {
        declaredSoilTemperatureC: 12, effectiveSoilTemperatureC: 12,
        temperatureFloored: false, source: "Reference", method: "Declared", warnings: [],
      },
    });
    const thousand = buildThousandYearDurabilityLedgerModel(args);
    for (const bytes of [
      await renderDurabilityLedgerPdf(twoHundred),
      await renderThousandYearDurabilityLedgerPdf(thousand),
    ]) {
      const text = await textOf(bytes);
      expect(text).toContain(`dMRV·${organizationName.toUpperCase().replaceAll(" ", "")}`);
      expect(text).not.toContain("DARKEARTHCARBON");
    }
  });
});
