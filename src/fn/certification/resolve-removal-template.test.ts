import { describe, expect, it } from "vitest";
import template from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import { resolveRemovalTemplate } from "./resolve-removal-template";

function facts(): FacilityCertifierFacts {
  return {
    // Deliberately a different default. It must never be used for a Removal.
    defaultTemplate: { ...template, id: "other-default" },
    templatesById: {
      [template.id]: {
        template, observation: { lineSources: {} }, enrichmentProblems: [], lineSourceProblems: [],
        blueprintsForTemplate: [], unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransportCategories: [],
      },
    },
  } as unknown as FacilityCertifierFacts;
}

describe("Removal template pins", () => {
  it("blocks an unpinned member without substituting the default", () => {
    const result = resolveRemovalTemplate([{ removalTemplateId: template.id }, { removalTemplateId: null }], facts());
    expect(result.removalTemplate).toBeNull();
    expect(result.templateBlockers).toEqual([{ code: "unpinnedTemplate", message: "Choose a Removal template for this credit batch." }]);
  });
  it("refuses mixed pins", () => {
    expect(resolveRemovalTemplate([{ removalTemplateId: template.id }, { removalTemplateId: "other-default" }], facts()).templateBlockers)
      .toEqual([{ code: "mixedTemplatePins", message: "These credit batches use different Removal templates." }]);
  });
  it("refuses a pin no longer listed even when a default exists", () => {
    const result = resolveRemovalTemplate([{ removalTemplateId: "deleted" }], facts());
    expect(result.removalTemplate).toBeNull();
    expect(result.templateBlockers).toEqual([{ code: "templateNotFound", message: "Template no longer exists in Isometric." }]);
  });
  it("uses the shared member pin", () => {
    const result = resolveRemovalTemplate([{ removalTemplateId: template.id }, { removalTemplateId: template.id }], facts());
    expect(result.removalTemplate?.id).toBe(template.id);
    expect(result.templateBlockers).toEqual([]);
  });
  it("blocks unread observations and proposals independently", () => {
    const input = facts();
    input.templatesById[template.id].observation = null;
    input.templatesById[template.id].lineSourceProblems = [{ code: "unassigned", componentId: "line" }];
    expect(resolveRemovalTemplate([{ removalTemplateId: template.id }], input).templateBlockers.map((blocker) => blocker.code))
      .toEqual(["templateNotFullyRead", "templateLinesNeedReview"]);
  });
});
