import { describe, expect, it } from "vitest";
import fixture from "../../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { sectionTemplateLines, templateLineSection, type ComponentType } from "./template-sections";
import { normalizeTemplateDefinition } from "./normalize";
import type { GhgEntryTemplate } from "./types";
import { removalTemplateReviewLines } from "@/lib/certification/removal-template-review-lines";

describe("templateLineSection", () => {
  it.each(["SEQUESTRATION", "REDUCTION"] as ComponentType[])("places %s in Mitigated", (type) => {
    expect(templateLineSection(type, "unknown")).toBe("mitigated");
  });
  it.each(["ACTIVITY", "COUNTERFACTUAL", "LOSS", "ADJUSTMENT", "UNCERTAINTY_DISCOUNT"] as ComponentType[])("places %s in Emitted even for a storage key", (type) => {
    expect(templateLineSection(type, "biochar_sequestration_future")).toBe("emitted");
  });
  it("falls back to the sequestration family only without a blueprint", () => {
    expect(templateLineSection(null, "biochar_sequestration_future")).toBe("mitigated");
    expect(templateLineSection(null, "unknown")).toBe("emitted");
  });
});

it("matches the sandbox sections, group counts and display-name order", () => {
  const template = fixture as GhgEntryTemplate;
  const lines = removalTemplateReviewLines(normalizeTemplateDefinition(template), {}, {}, [], template);
  const before = structuredClone(lines);
  const sections = sectionTemplateLines(lines);
  expect(sections.map(({ section, lineCount, groups }) => ({
    section, lineCount, groups: groups.map(({ name, lineCount }) => ({ name, lineCount })),
  }))).toEqual([
    { section: "mitigated", lineCount: 1, groups: [{ name: "CO₂ stored", lineCount: 1 }] },
    { section: "emitted", lineCount: 14, groups: [
      { name: "Biomass feedstock transport", lineCount: 1 },
      { name: "Pyrolysis", lineCount: 3 },
      { name: "Direct emissions", lineCount: 2 },
      { name: "Biochar transport", lineCount: 1 },
      { name: "Sampling required for MRV", lineCount: 5 },
      { name: "Staff travel", lineCount: 2 },
    ] },
  ]);
  expect(sections[1].groups.find((group) => group.name === "Pyrolysis")?.lines.map((line) => line.component.displayName))
    .toEqual(["Generator diesel usage", "Metered electricity use emissions", "Startup diesel usage"]);
  expect(lines).toEqual(before);
});

it("repeats split groups in both sections and omits empty sections", () => {
  const base = { groupKey: "shared", groupName: "Shared", groupPosition: 0 };
  const lines = [
    { ...base, section: "emitted" as const, component: { displayName: "banana" } },
    { ...base, section: "mitigated" as const, component: { displayName: "Stored" } },
    { ...base, section: "emitted" as const, component: { displayName: "Apple" } },
  ];
  const sections = sectionTemplateLines(lines);
  expect(sections.map((section) => [section.section, section.lineCount, section.groups[0].key]))
    .toEqual([["mitigated", 1, "shared"], ["emitted", 2, "shared"]]);
  expect(sections[1].groups[0].lines.map((line) => line.component.displayName)).toEqual(["Apple", "banana"]);
  expect(sectionTemplateLines([lines[0]]).map((section) => section.section)).toEqual(["emitted"]);
  expect(sectionTemplateLines([])).toEqual([]);
});
