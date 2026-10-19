import { expect, it } from "vitest";
import fixture from "../../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { fullFingerprint, semanticFingerprint } from "./fingerprints";
import { normalizeTemplateDefinition } from "./normalize";
import { resolveLineSources } from "./line-sources";
import { withTemplateOrder } from "./template-order";
import type { GhgEntryTemplate } from "./types";

it("captures raw array positions without mutating sources, definitions or fingerprints", () => {
  const template = fixture as GhgEntryTemplate;
  const definition = normalizeTemplateDefinition(template);
  const sources = resolveLineSources({ definition });
  const before = structuredClone(sources);
  const enriched = withTemplateOrder(template, sources);
  template.groups.forEach((group, groupPosition) => group.components.forEach((component, position) => {
    expect(enriched[component.id]).toEqual({ ...sources[component.id], templateOrder: { groupPosition, position } });
  }));
  const reversed = structuredClone(template);
  reversed.groups.reverse().forEach((group) => group.components.reverse());
  expect(withTemplateOrder(reversed, enriched)).not.toEqual(enriched);
  expect(normalizeTemplateDefinition(reversed)).toEqual(definition);
  expect(fullFingerprint(normalizeTemplateDefinition(reversed), {})).toBe(fullFingerprint(definition, {}));
  expect(semanticFingerprint(normalizeTemplateDefinition(reversed), {})).toBe(semanticFingerprint(definition, {}));
  expect(sources).toEqual(before);
});

it("does not create a contract for a missing assignment", () => {
  expect(withTemplateOrder(fixture as GhgEntryTemplate, {})).toEqual({});
});
