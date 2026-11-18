import { expect, it } from "vitest";
import templateFixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import type { FacilityCertifierFacts } from "@/lib/certification/facility-certifier-facts";
import { resolveRemovalTemplate } from "@/lib/certification/resolve-removal-template";
import type { GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { pinnedRemovalTemplateId } from "./removal-submission-finalization";

const template = templateFixture as GhgEntryTemplate;

function facts(): FacilityCertifierFacts {
  return {
    facilityTimezone: "UTC",
    // Deliberately a different default. It must never be used for a Removal.
    currentTemplate: { ...template, id: "other-default" },
    templatesById: {
      [template.id]: {
        template, observation: { lineSources: {} }, enrichmentProblems: [], lineSourceProblems: [],
        blueprintsForTemplate: [], unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransportCategories: [],
      },
    },
  } as unknown as FacilityCertifierFacts;
}

it.each([
  { pins: [] }, { pins: [null] }, { pins: [template.id, null] }, { pins: [template.id, "other-template"] },
])("uses the same refusal in readiness and recovery for $pins", ({ pins }) => {
  const batches = pins.map((removalTemplateId) => ({ removalTemplateId }));
  const readiness = resolveRemovalTemplate(batches, facts());
  expect(() => pinnedRemovalTemplateId(batches)).toThrow(readiness.templateBlockers[0].message);
});

it("recovers against the shared batch pin", () => {
  expect(pinnedRemovalTemplateId([{ removalTemplateId: template.id }])).toBe(template.id);
});
