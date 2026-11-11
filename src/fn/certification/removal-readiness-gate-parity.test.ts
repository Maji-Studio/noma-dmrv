import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import { deriveBatchEmissionLines } from "@/lib/certification/emission-lines";
import { deriveRemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeContext, setDurabilityMeasurementSamplesEnabled } from "../../../tests/fixtures/submit-removal-orchestrator";
import { make1000YearSequestrationTemplate, makeSequestrationTemplate } from "../../../tests/fixtures/submit-removal-templates";
import { reviewedTemplateSources } from "../../../tests/helpers/template-line-sources";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { buildRemovalRequirementsChecklist, deriveRemovalReadiness } from "@/lib/certification/readiness";
import { REMOVAL_TEMPLATE_BLOCKERS, removalTemplateBlocker, type RemovalTemplateBlockerCode } from "@/lib/certification/removal-template-blockers";
import { durabilityConfigurationBlockers } from "@/lib/certification/submission-readiness";
import { removalTemplateTierCompatibilityBlocker } from "@/lib/certification/removal-template-tier";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { REMOVAL_PREPARATION_BLOCKERS, removalSubmissionBindingOptions } from "@/lib/certification/removal-submission-prepare";
import { resolveRemovalTemplate } from "@/lib/certification/resolve-removal-template";
import type { BatchEmissionContext } from "@/lib/certification/batch-emission-context";
import type { FacilityCertifierFacts } from "@/lib/certification/facility-certifier-facts";
import { collectContextRemovalBlockers } from "./removal-blockers-gate";

type Context = ReturnType<typeof makeContext>;
type Fixture = () => Context;

beforeEach(() => setDurabilityMeasurementSamplesEnabled(false));
afterEach(() => setDurabilityMeasurementSamplesEnabled(false));

function facilityFacts(ctx: Context): FacilityCertifierFacts {
  const template = ctx.removalTemplate!;
  return { facilityTimezone: ctx.facilityTimezone, hasOrgCredentials: ctx.hasOrgCredentials, mapping: ctx.mapping, templatesById: { [template.id]: {
    template, observation: { lineSources: ctx.lineSources },
    enrichmentProblems: [], lineSourceProblems: [],
    blueprintsForTemplate: ctx.blueprintsForTemplate,
    unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransportCategories: [],
  } } } as unknown as FacilityCertifierFacts;
}

function resolveTemplateFacts(ctx: Context, batchFacts: BatchEmissionContext = {}): Context {
  return Object.assign(ctx, resolveRemovalTemplate(ctx.memberBatches, facilityFacts(ctx), batchFacts, ctx.removalEntryContext?.contributions));
}

function entryContext(): Context {
  const ctx = makeContext();
  ctx.removalEntryContext = { observationId: "observation", semanticFingerprint: "fingerprint", contributions: {
    manifest: [], inputs: [], entrySet: [], selectedEntryIds: [], sentSingleComponentIds: [], blockers: [],
  } };
  return ctx;
}

function durabilityContext(): Context {
  setDurabilityMeasurementSamplesEnabled(true);
  const ctx = makeContext(undefined, { removalTemplate: make1000YearSequestrationTemplate() });
  ctx.batchesWithSamples = ctx.batchesWithSamples.map(batch => ({ ...batch, durabilityOption: "1000_year" }));
  ctx.templateTierBlocker = removalTemplateTierCompatibilityBlocker(ctx, ctx.removalTemplate!);
  ctx.durabilityConfigurationBlockers = durabilityConfigurationBlockers(ctx.batchesWithSamples);
  return ctx;
}

function verdict(ctx: Context) {
  // buildRemovalContext supplies these derived fields; the UI and Overview use this exact adapter.
  return {
    readiness: deriveRemovalReadiness(toRemovalReadinessFacts(ctx)),
    blockers: collectContextRemovalBlockers(ctx, { beforeConfirmation: true }),
  };
}

const agreement: Array<[string, Fixture, string[], string?]> = [
  ["ready", () => makeContext(), []],
  ["zero-valued entry without a file", () => {
    const ctx = entryContext();
    const componentId = "zero-component";
    const observation: EntryObservation = {
      externalTemplateId: "template", definition: { groups: [{ id: "group", key: "pyrolysis", displayName: "Group", description: "", components: [{
        id: componentId, displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use",
        inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
      }] }] },
      lineSources: { [componentId]: { scope: "operating", origin: "reviewed", entryPolicy: "additive" } },
      enrichment: { [componentId]: { electricity_use: { unit: "kWh" } } },
    };
    const stored = { id: "zero-entry", creditBatchId: ctx.memberBatches[0].id, componentId, observationId: "observation",
      contentRevision: 1, kind: "value", lineRule: "additive", occurredOn: "2026-01-10", documentCount: 0,
      deletedAt: null, sentByRemovalId: null, sendReservedBySubmissionId: null, confirmedForRemovalId: null,
      evidenceDocumentIds: [], values: [{ inputKey: "electricity_use", magnitude: "0.000", unit: "kWh" }],
    } as unknown as Parameters<typeof deriveEmissionEntryFacts>[0][number];
    const entries = deriveEmissionEntryFacts([stored], observation, new Map([["observation", observation]]));
    const window = { start: "2026-01-01", end: "2026-02-01" };
    ctx.removalEntryContext!.contributions = deriveRemovalEntryContributions({
      removalId: ctx.removalId!, memberBatchIds: [stored.creditBatchId], window,
      contenders: [{ contenderKind: "draft", removalId: ctx.removalId!, creditBatchIds: [stored.creditBatchId], createdAt: window.start, window }],
      entries, lineSources: observation.lineSources, monitoredInputs: [{ componentId, inputKey: "electricity_use", unit: "kWh" }],
    });
    ctx.emissionLines = deriveBatchEmissionLines({ ...observation, entries, problems: [], enrichmentComplete: true, automaticFigures: {}, entriesCanSubmit: true });
    expect(ctx.emissionLines[0].state).toBe("filled");
    expect(ctx.removalEntryContext!.contributions.selectedEntryIds).toEqual([stored.id]);
    return ctx;
  }, []],
  ["empty template", () => resolveTemplateFacts(makeContext(undefined, { removalTemplate: { ...make1000YearSequestrationTemplate(), groups: [] } })), ["legacy"], REMOVAL_PREPARATION_BLOCKERS.emptyTemplate],
  ["durability unavailable", () => {
    const ctx = durabilityContext();
    setDurabilityMeasurementSamplesEnabled(false);
    ctx.isProduction = true;
    return ctx;
  }, ["legacy"], REMOVAL_PREPARATION_BLOCKERS.durabilityUnavailable],
  ["no mapping", () => makeContext(undefined, { mapping: null }), ["legacy"]],
  ["no credentials", () => makeContext(undefined, { hasOrgCredentials: false }), ["legacy"]],
  ["feedstock type mapping", () => makeContext(undefined, { feedstockTypeMappingGaps: [{ creditBatchId: "batch", creditBatchCode: "CB-1", feedstockTypeId: "type", feedstockTypeName: "Wood" }] }), ["feedstockTypeMapping"]],
  ["entity readiness", () => makeContext(undefined, { entityReadinessGaps: ["Record Sample moisture"] }), ["entityReadiness"]],
  ["no template", () => makeContext(undefined, { removalTemplate: null }), ["unpinnedTemplate"]],
  ...Object.keys(REMOVAL_TEMPLATE_BLOCKERS).map(code => [
    `template: ${code}`, () => makeContext(undefined, { templateBlockers: [removalTemplateBlocker(code as RemovalTemplateBlockerCode)] }), [code],
  ] satisfies [string, Fixture, string[]]),
  ["unresolved blueprint", () => makeContext(undefined, { unresolvedBlueprintKeys: ["retired"] }), ["legacy"]],
  ["unbindable template", () => {
    const ctx = makeContext();
    ctx.removalTemplate!.groups[0].components[0].blueprint_key = "unknown_blueprint";
    ctx.lineSources = reviewedTemplateSources(ctx.removalTemplate!);
    ctx.unbindableTemplateInputs = findUnbindableTemplateInputs(ctx.removalTemplate!, removalSubmissionBindingOptions(ctx, ctx.lineSources));
    return ctx;
  }, ["legacy"]],
  ["emission line", () => {
    const ctx = entryContext();
    ctx.emissionLines = [{ componentId: "line", blocker: { code: "lineHasNoSource", message: "Record a value.", fixTarget: "emissions" } }] as Context["emissionLines"];
    return ctx;
  }, ["lineHasNoSource"]],
  ["entry contribution", () => {
    const ctx = entryContext();
    const componentId = "meter-readings";
    const group = ctx.removalTemplate!.groups[0];
    group.components.push({
      ...group.components[0], id: componentId, blueprint_key: "metered_electricity",
      inputs: ["initial_readout", "final_readout"].map(input_key => ({
        type: "monitored" as const, input_key, display_name: input_key, quantity_kind: "energy" as const, datapoint_id: null,
      })),
    });
    ctx.lineSources = reviewedTemplateSources(ctx.removalTemplate!, {
      [componentId]: { scope: "operating", entryPolicy: "single", origin: "reviewed" },
    });
    ctx.removalEntryContext!.contributions.blockers = [{ code: "singleLineMultipleEntries", message: "Create separate Removals for these batches.", creditBatchId: ctx.memberBatches[0].id, fixTarget: "emissions", lineRef: { componentId, displayName: componentId } }];
    // The builder projects contribution blockers onto the matching emission lines.
    return resolveTemplateFacts(ctx, { [ctx.memberBatches[0].id]: {
      entries: [], previousObservations: new Map(),
      automaticFigures: { sequestration: { magnitude: "80", unit: "%" } },
    } });
  }, ["singleLineMultipleEntries"]],
  ["durability tier", () => {
    const ctx = durabilityContext();
    ctx.removalTemplate = makeSequestrationTemplate();
    // The 200-year helper leaves this line unassigned; isolate the tier mismatch with a reviewed contract.
    const componentId = ctx.removalTemplate.groups[0].components[0].id;
    ctx.lineSources = reviewedTemplateSources(ctx.removalTemplate, {
      [componentId]: { scope: "operating", entryPolicy: "none", origin: "reviewed" },
    });
    ctx.templateTierBlocker = removalTemplateTierCompatibilityBlocker(ctx, ctx.removalTemplate!);
    ctx.durabilityConfigurationBlockers = durabilityConfigurationBlockers(ctx.batchesWithSamples);
    return ctx;
  }, ["durabilityTier"]],
  ["durability configuration", () => {
    const ctx = durabilityContext();
    ctx.batchesWithSamples = ctx.batchesWithSamples.map(batch => ({ ...batch, sampling: "unsampled" }));
    ctx.durabilityConfigurationBlockers = durabilityConfigurationBlockers(ctx.batchesWithSamples);
    return ctx;
  }, ["durabilityConfiguration"]],
  ["no optional evidence", () => makeContext(undefined, { supportingDocuments: { total: 0, mirrored: 0 } }), []],
  ["pending evidence mirror", () => makeContext(undefined, { supportingDocuments: { total: 1, mirrored: 0 } }), []],
];

describe("Removal readiness and the before-confirmation gate agree", () => {
  it.each(agreement)("%s", (_label, fixture, codes, message) => {
    const ctx = fixture();
    const { readiness, blockers } = verdict(ctx);
    expect(blockers.map(blocker => blocker.code)).toEqual(codes);
    expect(readiness.state === "ready").toBe(blockers.length === 0);
    if (message) {
      expect(readiness).toMatchObject({ state: "blocked", reasons: [message] });
      expect(blockers.map(blocker => blocker.message)).toEqual([message]);
      expect(blockers[0].fixTarget).toBeNull();
      expect(buildRemovalRequirementsChecklist(toRemovalReadinessFacts(ctx))).toContainEqual(
        expect.objectContaining({
          key: message === REMOVAL_PREPARATION_BLOCKERS.durabilityUnavailable ? "durability" : "templateSet",
          status: "unmet", detail: message,
        }),
      );
    }
  });
});

// Tracked in docs/open-questions.md (certification/readiness-gate-drift), #1639.
// When a row is fixed, move it to the agreement table.
const knownDrift: Array<[string, Fixture, "ready" | "blocked", string[]]> = [
  // Coverage is checked by readiness and later compilation, outside the context prefix.
  ["missing transport", () => makeContext(undefined, { requiredTransportCategories: ["feedstock"] }), "blocked", []],
  // Positive leg count does not make an aggregation warning safe to submit.
  ["incomplete transport", () => {
    const ctx = makeContext(undefined, { requiredTransportCategories: ["feedstock"] });
    ctx.transportCoverage.feedstock.count = 1;
    ctx.transportCoverage.feedstock.aggregationWarning = "Missing load mass.";
    return ctx;
  }, "blocked", []],
  // The prefix does not inspect the production readiness fact.
  ["production gap", () => makeContext(undefined, { hasSubmittableRuns: false, runs: [], productionReadinessGap: { kind: "productionRunMissing", detail: "Production run could not be loaded.", fixTarget: "biocharProducts" } }), "blocked", []],
  // Date guards run in the build, after this prefix.
  ["future measurements", () => makeContext(undefined, { futureDatedMeasurements: ["Production run PR-1 ends in the future"] }), "blocked", []],
  // Delivery proof is refused by the lineage assertion in the build, not the prefix.
  ["delivery evidence", () => makeContext(undefined, { submissionLineageBlockers: [{ kind: "deliveryProof", instruction: "Attach evidence.", fact: "Delivery DL-1 has no proof.", detail: "Delivery DL-1 has no proof. Attach evidence.", fixTarget: "deliveryEvidence", record: { id: "delivery", code: "DL-1" } }] }), "blocked", []],
  // Sampling eligibility is checked in the build rather than in the prefix.
  ["durability eligibility", () => makeContext(undefined, { durabilityGateBlockers: ["Sample chemistry is incomplete."] }), "blocked", []],
];

describe("Known readiness versus before-confirmation gate drift", () => {
  it.each(knownDrift)("%s", (_label, fixture, state, codes) => {
    const { readiness, blockers } = verdict(fixture());
    expect(readiness.state).toBe(state);
    expect(blockers.map(blocker => blocker.code)).toEqual(codes);
    expect(readiness.state === "ready").not.toBe(blockers.length === 0);
  });
});
