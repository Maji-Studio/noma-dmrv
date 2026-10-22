import { makeContext, REMOVAL_ID } from "../../../tests/fixtures/submit-removal-orchestrator";
import { expect, it, vi } from "vitest";
import sandbox from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import registry from "../../../tests/fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { reviewedTemplateSources } from "../../../tests/helpers/template-line-sources";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import type { IsometricClient, IsometricComponentBlueprint, IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { Datapoint } from "@/lib/isometric/submissions";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { isSequestrationBlueprintFamily } from "@/lib/isometric/storage-blueprints";
import { deriveRemovalSemanticCorrection } from "@/lib/certification/removal-semantic-correction";
import { storedRemovalTemplateFacts } from "./stored-removal-template";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";

vi.mock("./biochar-application-intents", async original => ({
  ...await original<typeof import("./biochar-application-intents")>(), compileBiocharApplicationIntents: vi.fn(async () => []),
}));

it("compiles identical sent content from live fixture facts and their stored observation", async () => {
  const template = structuredClone(sandbox) as IsometricGhgEntryTemplate;
  const lineSources = reviewedTemplateSources(template);
  // Keep the fixture's supported automatic and storage scope. Entry-only lines
  // need operator entries; legacy paired transport has no automatic binding.
  const blocked = new Set(findUnbindableTemplateInputs(template, { lineSources }).map(item => item.componentId));
  template.groups = template.groups.map(group => ({ ...group, components: group.components.filter(component =>
    !blocked.has(component.id) && (lineSources[component.id]?.automaticSource || isSequestrationBlueprintFamily(component.blueprint_key))) }));
  const blueprints = registry.blueprints as IsometricComponentBlueprint[];
  const datapoints = registry.datapoints as Record<string, Datapoint>;
  const client = { get: vi.fn(async (path: string) => datapoints[path.split("/").at(-1)!]) } as unknown as IsometricClient;
  const enrichment = await loadTemplateEnrichment(client, template, blueprints);
  const observation = { id: "observation", externalTemplateId: template.id, externalProjectId: template.project_id,
    definition: normalizeTemplateDefinition(template), enrichment, lineSources,
  } as unknown as RemovalTemplateObservation;
  const stored = storedRemovalTemplateFacts(observation);
  const compile = async (removalTemplate: IsometricGhgEntryTemplate, blueprintFacts: IsometricComponentBlueprint[]) => {
    const context = makeContext(undefined, { removalTemplate, blueprintsForTemplate: blueprintFacts, lineSources,
      latestSubmission: null });
    context.batchesWithSamples = context.batchesWithSamples.map(batch => ({ ...batch, durabilityOption: "1000_year" }));
    context.memberBatchClaims = context.memberBatchClaims.map(batch => ({ ...batch, durabilityOption: "1000_year" }));
    expect(context.durabilityGateBlockers).toEqual([]);
    return buildRemovalSubmissionBuild({ orgCtx: makeTestOrgContext(), removalId: REMOVAL_ID, ctx: context,
      prepared: { removalTemplate, lineSources, blueprintsByKey: new Map(blueprintFacts.map(item => [item.key, item])),
        externalProjectId: template.project_id, hasDurabilityComponents: true },
      candidateSourceDocuments: [], sourceBindingCandidates: [], sourceIds: [],
    });
  };
  const live = await compile(template, blueprints);
  const rebuilt = await compile(stored.template, stored.blueprintsForTemplate);
  expect(live.monitored.length).toBeGreaterThan(0);
  expect(live.semanticPayload.sequestrationTemplate).not.toEqual([]);
  expect(rebuilt.semanticPayload).toEqual(live.semanticPayload);
  expect(deriveRemovalSemanticCorrection({ windowOpen: true, previous: live.semanticPayload, current: rebuilt.semanticPayload,
    previousEntries: [], currentEntries: [], componentIds: observation.definition.groups.flatMap(group => group.components.map(component => component.id)),
    batchIds: [makeContext().memberBatches[0].id],
  })).toMatchObject({ correctionNeeded: false, changedComponentIds: [], message: null });
});
