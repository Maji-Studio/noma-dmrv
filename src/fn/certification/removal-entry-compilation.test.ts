import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IsometricComponentBlueprint, IsometricGhgEntryTemplate } from "@/lib/isometric";
import { deriveRemovalEntryContributions, type RemovalEntryFact } from "@/lib/certification/removal-emission-contributions";
import type { LineSources } from "@/lib/isometric/template-observations/line-sources";
import type { RemovalSubmissionContext } from "./certify-context-core";
import { compileRemovalSubmission } from "./removal-submission-build";
import { prepareRemovalSubmission } from "./removal-submission-prepare";

// Keep compilation and entry selection real; isolate document and application I/O.
vi.mock("./biochar-application-intents", () => ({ compileBiocharApplicationIntents: vi.fn(async () => []) }));
vi.mock("./removal-evidence-plan", () => ({
  planRemovalEvidence: vi.fn(async () => ({
    candidateSourceDocuments: [], candidateDocumentIds: [], readySourceDocumentCount: 0,
    sourceIds: [], datapointSourceIds: [], biocharApplicationIntents: [],
    sourceBindingPlan: [], semanticSourceBindingPlan: [],
  })),
}));

const ORG_CTX = { userId: "user", organizationId: "org", orgRole: "owner", isPlatformAdmin: false } as const;
const REMOVAL_ID = "removal";
const BATCH_ID = "batch";
const ENTRY_COMPONENT_IDS = ["lab-electricity", "staff-electricity"];
const INPUT_KEY = "electricity_use";
const BLUEPRINT_KEY = "grid_electricity_use";
const VALUE_MAGNITUDE = "12";
const template = {
  id: "template", display_name: "Entry-capable Removal", credit_type: "REMOVAL",
  groups: [
    { key: "co2-stored", components: [{
      id: "storage", blueprint_key: "carbon_rich_substance_sequestration", display_name: "Storage",
      inputs: [{ type: "monitored", input_key: "product_mass", quantity_kind: "mass", datapoint_id: null }],
    }] },
    { key: "operations", components: ENTRY_COMPONENT_IDS.map((id) => ({
      id, blueprint_key: BLUEPRINT_KEY, display_name: id,
      inputs: [{ type: "monitored", input_key: INPUT_KEY, quantity_kind: "energy", datapoint_id: null }],
    })) },
  ],
} as IsometricGhgEntryTemplate;
const lineSources: LineSources = {
  storage: { scope: "operating", automaticSource: "sequestration", entryPolicy: "none", origin: "reviewed" },
  ...Object.fromEntries(ENTRY_COMPONENT_IDS.map((id) => [id, {
    scope: "operating", entryPolicy: "additive", origin: "reviewed",
  } as const])),
};
const blueprints = [{
  key: BLUEPRINT_KEY, inputs: [{ input_key: INPUT_KEY, compatible_unit: "kWh", quantity_kind: "energy", data_shape: "SCALAR" }],
}, {
  key: "carbon_rich_substance_sequestration",
  inputs: [{ input_key: "product_mass", compatible_unit: "kg", quantity_kind: "mass", data_shape: "SCALAR" }],
}] as IsometricComponentBlueprint[];

function context(kind: "zero" | "value", entriesEnabled = true) {
  const window = { start: "2026-01-01", end: "2026-01-03" };
  const entries: RemovalEntryFact[] = ENTRY_COMPONENT_IDS.map((componentId) => ({
    id: `entry-${componentId}`, componentId, creditBatchId: BATCH_ID, contentRevision: 1,
    kind, lineRule: "additive", occurredOn: window.start, deletedAt: null, sentByRemovalId: null,
    confirmedForRemovalId: kind === "zero" ? REMOVAL_ID : null, sendReservedBySubmissionId: null,
    counts: true, evidenceDocumentIds: kind === "zero" ? [] : ["evidence"],
    values: kind === "zero" ? [] : [{ inputKey: INPUT_KEY, magnitude: VALUE_MAGNITUDE, unit: "kWh" }],
  }));
  const contributions = deriveRemovalEntryContributions({
    removalId: REMOVAL_ID, memberBatchIds: [BATCH_ID], window, entries, lineSources,
    contenders: [{ contenderKind: "draft", removalId: REMOVAL_ID, createdAt: window.start, creditBatchIds: [BATCH_ID], window }],
    monitoredInputs: ENTRY_COMPONENT_IDS.map((componentId) => ({ componentId, inputKey: INPUT_KEY, unit: "kWh" })),
  });
  const ctx = {
    mapping: { externalProjectId: "project" }, hasOrgCredentials: true, templateBlockers: [],
    removalTemplate: template, lineSources, unresolvedBlueprintKeys: [], blueprintsForTemplate: blueprints,
    submissionLineageBlockers: [], entityReadinessGaps: [], submissionWarnings: [], durabilityGateBlockers: [],
    lineages: [{ application: { id: "application", code: "AP-1", applicationDate: new Date(window.end) },
      delivery: { id: "delivery", code: "DL-1" }, productionRun: { id: "run" }, warnings: [] }],
    runs: [{ id: "run", code: "RUN-1", startTime: new Date(window.start), endTime: new Date("2026-01-02"),
      biocharDryMassKg: 100, feedstockMassDryKg: 200, dieselOperationLiters: 0, dieselGensetLiters: 0,
      preprocessingFuelLiters: 0, electricityKwh: 0, samples: [] }],
    attributionByRunId: new Map([["run", 1]]), batchesWithSamples: [],
    transportLegs: { feedstock: [], biochar: [], sample: [] },
    memberBatchClaims: [{ creditBatchId: BATCH_ID, code: "CB-1", productionRunIds: ["run"], claimedByRemovalId: null }],
    memberBatches: [{ id: BATCH_ID, code: "CB-1" }], facilityReferenceSoilTemperature: null,
    ...(entriesEnabled ? { removalEntryContext: { contributions, batchFacts: {}, observationId: "observation", semanticFingerprint: "fingerprint" } } : {}),
  } as unknown as RemovalSubmissionContext;
  return ctx;
}

async function compile(ctx: RemovalSubmissionContext) {
  const preparation = prepareRemovalSubmission(ctx);
  expect(preparation.prepared).not.toBeNull();
  return { preparation, compiled: await compileRemovalSubmission({
    orgCtx: ORG_CTX, removalId: REMOVAL_ID, ctx, prepared: preparation.prepared!,
  }) };
}

describe("entry-only component compilation", () => {
  beforeEach(() => vi.stubEnv("EMISSIONS_ENTRIES_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());
  it.each(["zero", "value"] as const)("compiles recorded %s entries without an unbindable blocker", async (kind) => {
    const ctx = context(kind);
    expect(ctx.removalEntryContext?.contributions.blockers).toEqual([]);
    expect(ctx.removalEntryContext?.contributions.selectedEntryIds).toHaveLength(ENTRY_COMPONENT_IDS.length);
    const { preparation, compiled } = await compile(ctx);
    expect(preparation.blockers).toEqual([]);
    expect(compiled.blockers).toEqual([]);
    expect(compiled.transportPlan).not.toBeNull();
    for (const componentId of ENTRY_COMPONENT_IDS) {
      expect(compiled.review.bindings).toContainEqual(expect.objectContaining({
        componentId, inputKey: INPUT_KEY, wireMagnitude: kind === "zero" ? 0 : Number(VALUE_MAGNITUDE), wireUnit: "kWh",
      }));
    }
  });

  it("keeps entry-only components unbindable without an entry context", async () => {
    vi.stubEnv("EMISSIONS_ENTRIES_ENABLED", "false");
    const { preparation, compiled } = await compile(context("zero", false));
    expect(preparation.blockers.map((blocker) => blocker.code)).toContain("templateUnbindable");
    expect(compiled.blockers).toEqual([preparation.blockers.find((blocker) => blocker.code === "templateUnbindable")!.message]);
    expect(compiled.transportPlan).toBeNull();
  });

  it("leaves incomplete enrichment to its own blocker in both paths", async () => {
    const ctx = context("zero", false);
    const { prepared } = prepareRemovalSubmission(ctx);
    ctx.templateBlockers = [{ code: "templateNotFullyRead", message: "Read the template first." }];
    ctx.entityReadinessGaps = ["Application AP-1: Upload the application logbook"];
    expect(prepareRemovalSubmission(ctx).blockers).toEqual(ctx.templateBlockers);
    const compiled = await compileRemovalSubmission({ orgCtx: ORG_CTX, removalId: REMOVAL_ID, ctx, prepared: prepared! });
    // The mapping gate must not mislabel unread inputs as unbindable, even
    // if a caller still holds an earlier prepared bundle.
    expect(compiled.blockers).toEqual([
      "Complete these fields before submitting the Removal:\nApplication AP-1: Upload the application logbook",
    ]);
  });
});
