import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailField } from "@/components/ui/detail-panel";
import type { SampleWithRelations } from "@/data-access/samples";

vi.mock("@/components/transport-legs", () => ({ TransportLegsSummary: () => null }));
vi.mock("./sample-documents-panel", () => ({ SampleDocumentsPanel: () => null }));

import { formatSamplingTime, sampleSheetSections } from "./sample-read-sections";

describe("formatSamplingTime", () => {
  const samplingTime = new Date("2026-03-10T07:30:00.000Z");

  it("reads the time on the batch facility's clock", () => {
    // 07:30 UTC is 10:30 in Dar es Salaam (UTC+3).
    expect(formatSamplingTime({ samplingTime, facilityTimezone: "Africa/Dar_es_Salaam" })).toContain("10:30");
    expect(formatSamplingTime({ samplingTime, facilityTimezone: "UTC" })).toContain("07:30");
  });
});

describe("Sample read-view certification chips", () => {
  it.each([
    { durabilityOption: "200_year", sampling: "sampled", chemistryRequired: true },
    { durabilityOption: "1000_year", sampling: "sampled", chemistryRequired: true },
    { durabilityOption: "200_year", sampling: "unsampled", chemistryRequired: false },
    { durabilityOption: "1000_year", sampling: "unsampled", chemistryRequired: false },
    { durabilityOption: "1000_year", sampling: null, chemistryRequired: false },
  ] as const)("matches the form's conditions for $sampling $durabilityOption batches", ({ durabilityOption, sampling, chemistryRequired }) => {
    const sample = {
      id: "sample", creditBatchCode: "CB-1", samplingTime: new Date("2026-09-10T08:00:00Z"),
      facilityTimezone: "UTC", durabilityOption, sampling,
      organicCarbonPercent: 75, hToCOrgRatio: 0.24, oToCOrgRatio: 0.06,
      sReflectanceFraction: 0.9, nutrientClaimEnabled: false,
    } as SampleWithRelations;
    const fields = sampleSheetSections(sample).flatMap((section) => section.fields);
    for (const label of ["Organic carbon", "H:C org ratio", "O:C org ratio"]) {
      const field = fields.find((field) => field.label === label)!;
      const markup = renderToStaticMarkup(<DetailField {...field} />);
      expect(markup).toContain(label);
      expect(markup.includes('data-cert-field="satisfied"')).toBe(chemistryRequired);
    }
    const reflectance = fields.find((field) => field.label === "R₀ readings ≥ 2%");
    if (durabilityOption === "1000_year") {
      const markup = renderToStaticMarkup(<DetailField {...reflectance!} />);
      expect(markup).toContain("90%");
      expect(markup.includes('data-cert-field="satisfied"')).toBe(chemistryRequired);
    } else {
      expect(reflectance).toBeUndefined();
    }
  });
});
