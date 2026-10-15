import { describe, expect, it } from "vitest";
import sandboxFixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import culaFixture from "../../../tests/fixtures/isometric/cula-template-2026-10-15.json";
import type { ProductionRunForCertification } from "@/lib/isometric/utils/aggregation";
import { normalizeTemplateDefinition, resolveLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { buildSubmissionWarnings } from "./submission-warnings";

const sandbox = sandboxFixture as GhgEntryTemplate;
const cula = culaFixture as GhgEntryTemplate;

const GENSET = "rtc_1KWHFRM4GSBX5Y7A";
const STARTUP = "rtc_1KWP4Y13JSBXV8FB";
const ELECTRICITY = "rtc_1KVFZ1MY9SBXFWVN";
function warnings(template: GhgEntryTemplate, recorded = { dieselGensetLiters: 7, preprocessingFuelLiters: 3, dieselOperationLiters: 5, electricityKwh: 10 }) {
  return buildSubmissionWarnings({
    removalTemplate: template,
    lineSources: resolveLineSources({ definition: normalizeTemplateDefinition(template) }),
    runs: [{ ...recorded, startTime: new Date("2026-10-01") } as ProductionRunForCertification], lineages: [],
  });
}

describe("dropped recorded automatic sources", () => {
  it("keeps all recorded sources when their effective lines remain", () => {
    expect(warnings(sandbox)).toEqual([]);
  });
  it.each([[GENSET, "Genset diesel"], [STARTUP, "Startup diesel"], [ELECTRICITY, "Electricity"]])("warns only for the removed %s source", (id, label) => {
    const template = structuredClone(sandbox);
    for (const group of template.groups) group.components = group.components.filter((component) => component.id !== id);
    expect(warnings(template)).toEqual([expect.stringContaining(`${label} is recorded`)]);
  });
  it("warns for preprocessing fuel in the genset bucket independently", () => {
    const template = structuredClone(sandbox);
    for (const group of template.groups) group.components = group.components.filter((component) => component.id !== GENSET);
    expect(warnings(template, { dieselGensetLiters: 0, preprocessingFuelLiters: 3, dieselOperationLiters: 0, electricityKwh: 0 })).toEqual([expect.stringContaining("Genset diesel")]);
  });
  it("does not treat an entry-only meter as an automatic electricity source", () => {
    expect(warnings(cula)).toEqual([expect.stringContaining("Electricity is recorded")]);
  });
  it("ignores zero and absent records, and preserves the month advisory", () => {
    expect(warnings(sandbox, { dieselGensetLiters: 0, preprocessingFuelLiters: 0, dieselOperationLiters: 0, electricityKwh: 0 })).toEqual([]);
    expect(buildSubmissionWarnings({ removalTemplate: null, lineSources: {}, runs: [{ startTime: new Date("2026-09-30") } as ProductionRunForCertification],
      lineages: [{ application: { applicationDate: new Date("2026-10-01") } }],
    })).toEqual([expect.stringContaining("Reporting window spans multiple months")]);
  });
  it("warns when an automatic source is only proposed", () => {
    const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(sandbox) });
    lineSources[GENSET].origin = "proposed";
    expect(buildSubmissionWarnings({ removalTemplate: sandbox, lineSources,
      runs: [{ dieselGensetLiters: 1 } as ProductionRunForCertification], lineages: [],
    })).toEqual([expect.stringContaining("Genset diesel")]);
  });
});
