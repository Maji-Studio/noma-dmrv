import { expect, it } from "vitest";
import type { IsometricComponentBlueprint, IsometricGhgEntryTemplate } from "@/lib/isometric";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations/normalize";
import { withTemplateOrder } from "@/lib/isometric/template-observations/template-order";
import { resolveLineSources } from "@/lib/isometric/template-observations/line-sources";
import { removalTemplateReviewLines } from "./removal-template-review-lines";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";

const template = fixture as IsometricGhgEntryTemplate;
const definition = normalizeTemplateDefinition(template);
const sources = withTemplateOrder(template, resolveLineSources({ definition }));

it("prefers the current REST order over stored and normalized order", () => {
  const reversed = { ...template, groups: [...template.groups].reverse() };
  const lines = removalTemplateReviewLines(definition, sources, {}, [], reversed);
  for (const line of lines) {
    expect(line.groupPosition).toBe(reversed.groups.findIndex((group) => group.key === line.groupKey));
  }
});

it("falls back to stored template order, then normalized order", () => {
  const storedLines = removalTemplateReviewLines(definition, sources, {}, []);
  const normalizedLines = removalTemplateReviewLines(definition, {}, {}, []);
  for (const line of storedLines) {
    expect(line.groupPosition).toBe(template.groups.findIndex((group) => group.key === line.groupKey));
  }
  for (const line of normalizedLines) {
    expect(line.groupPosition).toBe(definition.groups.findIndex((group) => group.key === line.groupKey));
  }
});

it("uses loaded blueprint types including reduction and falls back for unknown blueprints", () => {
  const blueprints = [{ key: "grid_electricity_use", type: "REDUCTION" }] as IsometricComponentBlueprint[];
  const lines = removalTemplateReviewLines(definition, sources, {}, blueprints, template);
  expect(lines.filter((line) => line.component.blueprintKey === "grid_electricity_use"))
    .toEqual(expect.arrayContaining([expect.objectContaining({ blueprintType: "REDUCTION", section: "mitigated" })]));
  expect(lines.find((line) => line.component.blueprintKey.startsWith("biochar_sequestration_")))
    .toMatchObject({ blueprintType: null, section: "mitigated" });
  expect(lines.find((line) => line.component.blueprintKey === "fuel_usage_by_volume"))
    .toMatchObject({ blueprintType: null, section: "emitted" });
});
