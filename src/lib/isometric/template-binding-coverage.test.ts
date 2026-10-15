import { describe, expect, it } from "vitest";
import sandbox from "../../../tests/fixtures/isometric/sandbox-template.json";
import realTemplate from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { unsupportedTemplate } from "../../../tests/fixtures/isometric/unsupported-template";
import { reviewedTemplateSources } from "../../../tests/helpers/template-line-sources";
import type { GhgEntryTemplate, LineSources } from "./template-observations";
import { normalizeTemplateDefinition, resolveLineSources } from "./template-observations";
import { findUnbindableTemplateInputs, formatUnbindableTemplateInputs, formatUnbindableTemplateInputsText } from "./template-binding-coverage";
import { lookupInputMapping, resolveDatapointSource } from "./datapoint-mapping";

const template = sandbox as GhgEntryTemplate;
const sourceLines = reviewedTemplateSources(template);
function coverage(value: GhgEntryTemplate, lineSources: LineSources = reviewedTemplateSources(value), allowPeriodInputStub = false) {
  return findUnbindableTemplateInputs(value, { lineSources, allowPeriodInputStub });
}

describe("contract-based template coverage", () => {
  it.each([true, false])("accepts the bootstrap sandbox template (stubs: %s)", (stubs) => {
    expect(coverage(template, sourceLines, stubs)).toEqual([]);
  });
  it("blocks every unassigned line", () => {
    const findings = coverage(template, {});
    expect(findings).toHaveLength(template.groups.flatMap((group) => group.components).length);
    expect(findings.every((finding) => finding.reason === "unassigned")).toBe(true);
  });
  it("blocks a proposal until review", () => {
    const copy = structuredClone(template);
    const electricity = copy.groups.flatMap((group) => group.components).find((component) => component.blueprint_key === "grid_electricity_use")!;
    electricity.id = "new-electricity";
    const sources = resolveLineSources({ definition: normalizeTemplateDefinition(copy) });
    expect(coverage(copy, sources)).toContainEqual(expect.objectContaining({ componentId: electricity.id, reason: "unassigned" }));
  });
  it("gets ambiguity from shared automatic sources", () => {
    const copy = structuredClone(template);
    const group = copy.groups.find((group) => group.key === "biochar-transport")!;
    const first = group.components[0];
    group.components.push({ ...structuredClone(first), id: "second", display_name: "Second shipment" });
    const findings = coverage(copy).filter((finding) => finding.reason === "ambiguous");
    expect(findings.map((finding) => finding.componentId).sort()).toEqual([first.id, "second"].sort());
    expect(formatUnbindableTemplateInputsText(findings)).toContain("Choose a different automatic source for each line.");
  });
  it("resolves a renamed diesel component with the same id", () => {
    const copy = structuredClone(template);
    const group = copy.groups.find((group) => group.key === "pyrolysis")!;
    const diesel = group.components.find((component) => component.display_name === "Generator diesel usage")!;
    diesel.display_name = "Renamed generator";
    expect(coverage(copy, sourceLines)).toEqual([]);
    const mapping = lookupInputMapping(group.key, diesel.blueprint_key, "volume_of_fuel", sourceLines[diesel.id])!;
    expect(resolveDatapointSource(mapping, sourceLines[diesel.id])).toBe("totalGensetDieselLitres");
    diesel.id = "replacement-id";
    expect(coverage(copy, resolveLineSources({ definition: normalizeTemplateDefinition(copy), previous: { definition: normalizeTemplateDefinition(template), lineSources: sourceLines } })))
      .toContainEqual(expect.objectContaining({ componentId: diesel.id, reason: "unassigned" }));
  });
  it("still fails closed on diesel without a contract", () => {
    const mapping = lookupInputMapping("pyrolysis", "fuel_usage_by_volume", "volume_of_fuel")!;
    expect(() => resolveDatapointSource(mapping)).toThrow("Review the Removal template lines in Certification settings.");
  });
  it("preserves production period guards and sandbox stubs for entry-only lines", () => {
    const value = realTemplate as GhgEntryTemplate;
    expect(coverage(value).some((finding) => finding.reason === "project-scope")).toBe(true);
    expect(coverage(value, reviewedTemplateSources(value), true)).toEqual([]);
  });
  it("blocks forbidden lines even in sandbox", () => {
    const first = template.groups.flatMap((group) => group.components)[0];
    expect(coverage(template, { ...sourceLines, [first.id]: { scope: "forbidden", entryPolicy: "none", origin: "reviewed" } }, true))
      .toContainEqual(expect.objectContaining({ componentId: first.id, reason: "project-scope" }));
  });
  it("reports unsupported paired transport with repair guidance", () => {
    const findings = coverage(unsupportedTemplate());
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.reason === "unmapped")).toBe(true);
    const formatted = formatUnbindableTemplateInputs(findings);
    expect(formatted.lead).toBe("The Removal template has 2 components noma cannot submit.");
    expect(formatted.lines.join(" ")).toContain("Replace each one with a Mass-distance-based CI emissions component");
    expect(formatUnbindableTemplateInputsText(findings)).toBe([formatted.lead, ...formatted.lines].join("\n"));
    expect(formatUnbindableTemplateInputsText([])).toBe("");
  });
});
