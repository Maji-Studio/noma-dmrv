import { describe, expect, it } from "vitest";
import { TRANSPORT_BLUEPRINT_KEY } from "../src/lib/isometric/emission-line-constants";
import sandbox from "../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import {
  BOOTSTRAP_LINE_SOURCES,
  normalizeTemplateDefinition,
  resolveLineSources,
  type GhgEntryTemplate,
} from "../src/lib/isometric/template-observations";
import { evaluateTemplateCoverage } from "./isometric-coverage-core";

const template = sandbox as GhgEntryTemplate;

describe("coverage health check", () => {
  it("warns for exactly the nine entry-only operating components in the real template", () => {
    const components = template.groups.flatMap((group) => group.components);
    const expectedIds = components.filter((component) => {
      const contract = BOOTSTRAP_LINE_SOURCES[component.id];
      return contract?.scope === "operating" && !contract.automaticSource;
    }).map((component) => component.id).sort();
    const { failures, entryOnly } = evaluateTemplateCoverage(template);

    expect(failures).toEqual([]);
    expect(entryOnly).toHaveLength(9);
    expect(entryOnly.map((finding) => finding.componentId).sort()).toEqual(expectedIds);
    expect(entryOnly.every((finding) => finding.state === "empty")).toBe(true);
  });

  it("fails for an extra component without a settled bootstrap contract", () => {
    const copy = structuredClone(template);
    const group = copy.groups.find((group) => group.components.length > 0)!;
    group.components.push({ ...structuredClone(group.components[0]), id: "unknown-component" });

    expect(evaluateTemplateCoverage(copy).failures).toContainEqual(expect.objectContaining({
      componentId: "unknown-component", state: "needsReview",
    }));
  });

  it("fails when an entry-only sample-shipping component changes to the transport blueprint", () => {
    const copy = structuredClone(template);
    const componentId = "rtc_1M4ZRPH1RSBXADG2";
    const component = copy.groups.flatMap((group) => group.components)
      .find((component) => component.id === componentId)!;
    component.blueprint_key = TRANSPORT_BLUEPRINT_KEY;

    const { failures, entryOnly } = evaluateTemplateCoverage(copy);
    expect(failures).toContainEqual(expect.objectContaining({ componentId }));
    expect(entryOnly.some((finding) => finding.componentId === componentId)).toBe(false);
  });

  it("fails when an entry-only sampling-consumables input changes to an unknown catalog key", () => {
    const copy = structuredClone(template);
    const componentId = "rtc_1M4ZRTZFXSBXS0YP";
    const component = copy.groups.flatMap((group) => group.components)
      .find((component) => component.id === componentId)!;
    const input = component.inputs.find((input) => input.type === "monitored" && input.input_key === "mass")!;
    input.input_key = "unknown_mass";

    const { failures, entryOnly } = evaluateTemplateCoverage(copy);
    expect(failures).toContainEqual(expect.objectContaining({ componentId }));
    expect(entryOnly.some((finding) => finding.componentId === componentId)).toBe(false);
  });

  it("fails for a forbidden contract", () => {
    const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
    const componentId = template.groups.flatMap((group) => group.components)[0].id;
    lineSources[componentId] = { scope: "forbidden", entryPolicy: "none", origin: "reviewed" };

    expect(evaluateTemplateCoverage(template, { lineSources }).failures).toEqual([
      expect.objectContaining({ componentId, state: "needsSetup", reason: "project-scope" }),
    ]);
  });

  it("fails for an unmapped monitored input on an entry-only line", () => {
    const copy = structuredClone(template);
    const entryOnlyId = evaluateTemplateCoverage(template).entryOnly[0].componentId;
    const component = copy.groups.flatMap((group) => group.components)
      .find((component) => component.id === entryOnlyId)!;
    component.inputs.push({ ...structuredClone(component.inputs[0]), input_key: "unknown-input", type: "monitored" });

    const { failures, entryOnly } = evaluateTemplateCoverage(copy);
    expect(failures).toContainEqual(expect.objectContaining({
      componentId: entryOnlyId, inputKey: "unknown-input", reason: "unmapped",
    }));
    expect(entryOnly.some((finding) => finding.componentId === entryOnlyId)).toBe(false);
  });
});
