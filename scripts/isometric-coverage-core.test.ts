import { describe, expect, it } from "vitest";
import { TRANSPORT_BLUEPRINT_KEY } from "../src/lib/isometric/emission-line-constants";
import sandbox from "../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import timeSandbox from "../tests/fixtures/isometric/sandbox-template-2026-11-05.json";
import coverageFixture from "../tests/fixtures/isometric-coverage.json";
import {
  BOOTSTRAP_LINE_SOURCES,
  normalizeTemplateDefinition,
  resolveLineSources,
  type GhgEntryTemplate,
} from "../src/lib/isometric/template-observations";
import { coverageFixtureSchema, evaluateTemplateCoverage, resolveCoverageLineSources } from "./isometric-coverage-core";

const template = sandbox as GhgEntryTemplate;
const timeTemplate = timeSandbox as GhgEntryTemplate;
const reviewedLineSources = coverageFixtureSchema.parse(coverageFixture).facilities[0].reviewedLineSources!;
const timeComponentIds = ["rtc_1M6NMG60MSBXQ6VN", "rtc_1M6NM8QWWSBX8KD1"];

describe("coverage health check", () => {
  it("requires review of both November time-based lines without fixture decisions", () => {
    const lineSources = resolveCoverageLineSources(timeTemplate);
    expect(evaluateTemplateCoverage(timeTemplate, { lineSources }).failures).toEqual(
      timeComponentIds.map((componentId) => expect.objectContaining({ componentId, state: "needsReview", reason: "unassigned" })),
    );
  });

  it("passes the November template with the fixture's reviewed additive hours", () => {
    expect(Object.keys(reviewedLineSources).sort()).toEqual([...timeComponentIds].sort());
    const lineSources = resolveCoverageLineSources(timeTemplate, reviewedLineSources);
    for (const id of timeComponentIds) {
      expect(lineSources[id]).toEqual({ scope: "operating", entryPolicy: "additive", origin: "reviewed" });
    }
    const { failures, entryOnly } = evaluateTemplateCoverage(timeTemplate, { lineSources });
    expect(failures).toEqual([]);
    expect(entryOnly.map((finding) => finding.componentId)).toEqual(expect.arrayContaining(timeComponentIds));
  });

  it("rejects stale fixture decisions for unknown component IDs", () => {
    expect(() => resolveCoverageLineSources(timeTemplate, {
      ...reviewedLineSources,
      rtc_stale: { scope: "operating", entryPolicy: "additive" },
    })).toThrow(/unknown component IDs: rtc_stale/);
  });

  it("still fails for a new live line without a fixture decision", () => {
    const copy = structuredClone(timeTemplate);
    const group = copy.groups.find((group) => group.components.some((component) => component.id === timeComponentIds[0]))!;
    const component = group.components.find((component) => component.id === timeComponentIds[0])!;
    group.components.push({ ...structuredClone(component), id: "rtc_new_time" });
    const lineSources = resolveCoverageLineSources(copy, reviewedLineSources);
    expect(evaluateTemplateCoverage(copy, { lineSources }).failures).toEqual([
      expect.objectContaining({ componentId: "rtc_new_time", state: "needsReview", reason: "unassigned" }),
    ]);
  });

  it("validates reviewed fixture decisions against the live input shape", () => {
    const componentId = timeComponentIds[0];
    const lineSources = resolveCoverageLineSources(timeTemplate, {
      ...reviewedLineSources,
      [componentId]: { scope: "operating", entryPolicy: "single" },
    });
    expect(evaluateTemplateCoverage(timeTemplate, { lineSources }).failures).toEqual([
      expect.objectContaining({ componentId, state: "needsReview" }),
    ]);
  });

  it("fails for an unsupported monitored shape despite a reviewed additive contract", () => {
    const copy = structuredClone(timeTemplate);
    const componentId = timeComponentIds[0];
    const component = copy.groups.flatMap((group) => group.components)
      .find((component) => component.id === componentId)!;
    const input = component.inputs.find((input) => input.type === "monitored")!;
    input.input_key = "pressure";
    input.quantity_kind = "pressure";
    const lineSources = resolveCoverageLineSources(copy, reviewedLineSources);

    const { failures, entryOnly } = evaluateTemplateCoverage(copy, { lineSources });
    expect(failures).toEqual([
      expect.objectContaining({ componentId, state: "needsReview" }),
    ]);
    expect(entryOnly.some((finding) => finding.componentId === componentId)).toBe(false);
  });

  it.each([
    { scope: "operating", entryPolicy: "typo" },
    { scope: "typo", entryPolicy: "additive" },
    { scope: "operating", entryPolicy: "additive", automaticSource: "typo" },
    { scope: "operating", entryPolicy: "additive", filePolicy: "typo" },
    { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
    { scope: "operating", entryPolcy: "additive" },
  ])("rejects malformed fixture decisions: %j", (contract) => {
    const copy = structuredClone(coverageFixture);
    const fixture = { facilities: [{ ...copy.facilities[0], reviewedLineSources: { [timeComponentIds[0]]: contract } }] };
    expect(coverageFixtureSchema.safeParse(fixture).success).toBe(false);
  });

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
    expect(entryOnly.map((finding) => finding.componentId)).toEqual(expect.arrayContaining(["rtc_1M4ZRPH1RSBXADG2", "rtc_1M4ZRRN6PSBXHQ7C"]));
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


it("accepts an optional stored proof setting in reviewed contracts", () => {
  const componentId = timeComponentIds[0];
  const fixture = { facilities: [{ ...coverageFixture.facilities[0], reviewedLineSources: {
    [componentId]: { scope: "operating", entryPolicy: "additive", filePolicy: "none" },
  } }] };
  const parsed = coverageFixtureSchema.parse(fixture).facilities[0];
  expect(resolveCoverageLineSources(timeTemplate, parsed.reviewedLineSources)[componentId].filePolicy).toBe("none");
});
