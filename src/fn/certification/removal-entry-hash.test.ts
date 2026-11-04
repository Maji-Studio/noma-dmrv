import { reviewedTemplateSources } from "../../../tests/helpers/template-line-sources";
import { expect, it, vi } from "vitest";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import { semanticFingerprint, fullFingerprint } from "@/lib/isometric/template-observations/fingerprints";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import { deriveRemovalEntryInputs } from "@/lib/certification/removal-entry-inputs";
import { emissionEntrySourceCandidates } from "@/lib/certification/emission-entry-source-bindings";
import { buildRemovalSourceDescription } from "@/lib/certification/removal-source-bindings";
import { reviewPayloadHash } from "@/lib/certification/removal-review-hash";
import type { RemovalSubmissionContext } from "./certify-context-core";
import { normalizeCarriedEntriesForHash } from "./removal-entry-hash";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";

vi.mock("./biochar-application-intents", async (original) => ({
  ...await original<typeof import("./biochar-application-intents")>(),
  compileBiocharApplicationIntents: vi.fn(async () => []),
}));

function observation(displayName: string): EntryObservation {
  return { externalTemplateId: "template", definition: { groups: [{ id: "g", key: "operating", displayName: "Operating", description: "",
    components: [{ id: "entry-component", displayName, description: null, blueprintKey: "grid_electricity_use",
      inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }],
  }] }, enrichment: { "entry-component": { electricity_use: { unit: "kWh" } } },
  lineSources: { "entry-component": { scope: "operating", entryPolicy: "additive", origin: "reviewed" } } };
}
async function build(current: EntryObservation, batchCode: string, kind: "value" | "zero", revision = 1, documentId = "document", earlierRemovalCode?: string) {
  const contributions = deriveRemovalEntryInputs({ observation: current, removalId: "removal", memberBatchIds: ["batch"],
    creditBatchCodes: { batch: batchCode }, window: { start: "2026-01-01", end: "2026-01-03" }, reservations: [], nowMs: 0,
    contenders: [{ contenderKind: "draft", removalId: "removal", createdAt: "2026-01-01", creditBatchIds: ["batch"], window: { start: "2026-01-01", end: "2026-01-03" } }],
    entries: [{ id: "entry", creditBatchId: "batch", componentId: "entry-component", contentRevision: revision, kind, lineRule: "additive",
      occurredOn: "2026-01-02", counts: true, deletedAt: null, sentByRemovalId: null, sendReservedBySubmissionId: null,
      confirmedForRemovalId: kind === "zero" ? "removal" : null, evidenceDocumentIds: kind === "zero" ? [] : [documentId],
      values: [{ inputKey: "electricity_use", magnitude: "2", unit: "kWh" }] }],
  });
  if (earlierRemovalCode) contributions.carriedEntries = [{
    entryId: "entry", creditBatchId: "batch", creditBatchCode: batchCode,
    componentId: "entry-component", componentName: current.definition.groups[0].components[0].displayName,
    occurredOn: "2026-01-02", value: { magnitude: "2", unit: "kWh" },
    evidenceDocumentIds: [documentId], earlierRemovalId: "earlier-removal", earlierRemovalCode,
  }];
  expect(contributions.blockers).toEqual([]);
  const template = { id: "template", groups: [
    { key: "co2-stored", components: [{ id: "storage", blueprint_key: "carbon_rich_substance_sequestration", inputs: [
      { input_key: "product_mass", type: "monitored", quantity_kind: "mass" },
    ] }] },
    { key: "operating", components: [{ id: "entry-component", display_name: current.definition.groups[0].components[0].displayName,
      blueprint_key: "grid_electricity_use", inputs: [{ input_key: "electricity_use", type: "monitored", quantity_kind: "energy" }] }] },
  ] };
  const lineSources = reviewedTemplateSources(template as never, current.lineSources);
  const ctx = {
    submissionLineageBlockers: [], entityReadinessGaps: [], submissionWarnings: [], durabilityGateBlockers: [],
    runs: [{ id: "run", code: "RUN-001", startTime: new Date("2026-01-01"), endTime: new Date("2026-01-02"),
      biocharDryMassKg: 1200, feedstockMassDryKg: 4000, dieselOperationLiters: 0, dieselGensetLiters: 0,
      preprocessingFuelLiters: 0, electricityKwh: 0, samples: [] }],
    lineages: [{ application: { id: "application", applicationDate: new Date("2026-01-03") },
      delivery: { id: "delivery" }, productionRun: { id: "run" }, feedstocks: [], warnings: [] }],
    attributionByRunId: new Map([["run", 1]]), transportLegs: { feedstock: [], biochar: [], sample: [] },
    batchesWithSamples: [], memberBatches: [{ id: "batch", code: batchCode }],
    memberBatchClaims: [{ creditBatchId: "batch", claimedByRemovalId: null, productionRunIds: ["run"], applicationIds: ["application"] }],
    lineSources,
    removalEntryContext: { contributions, observationId: fullFingerprint(current.definition, current.enrichment),
      semanticFingerprint: semanticFingerprint(current.definition, current.enrichment) },
  } as unknown as RemovalSubmissionContext;
  const candidates = emissionEntrySourceCandidates(contributions).map((candidate) => ({ ...candidate, sourceId: "source" }));
  return buildRemovalSubmissionBuild({ orgCtx: makeTestOrgContext(), removalId: "removal", ctx,
    prepared: { removalTemplate: template, lineSources, blueprintsByKey: new Map([
      ["carbon_rich_substance_sequestration", { key: "carbon_rich_substance_sequestration", inputs: [{ input_key: "product_mass", compatible_unit: "kg", data_shape: "SCALAR", quantity_kind: "mass" }] }],
      ["grid_electricity_use", { key: "grid_electricity_use", inputs: [{ input_key: "electricity_use", compatible_unit: "kWh", data_shape: "SCALAR", quantity_kind: "energy" }] }],
    ]), externalProjectId: "project", allowPeriodInputStub: false, hasDurabilityComponents: false } as never,
    candidateSourceDocuments: candidates, sourceBindingCandidates: candidates,
  });
}

it.each(["value", "zero"] as const)("keeps cosmetic observation and batch changes out of the %s submission hash", async (kind) => {
  const original = observation("Electricity");
  const renamed = observation("Site electricity");
  expect(fullFingerprint(original.definition, original.enrichment)).not.toBe(fullFingerprint(renamed.definition, renamed.enrichment));
  expect(semanticFingerprint(original.definition, original.enrichment)).toBe(semanticFingerprint(renamed.definition, renamed.enrichment));
  const baseline = await build(original, "CB-001", kind);
  for (const changed of [await build(renamed, "CB-001", kind), await build(original, "CB-RENAMED", kind)]) {
    expect(payloadHash(changed.semanticPayload)).toBe(payloadHash(baseline.semanticPayload));
    expect(reviewPayloadHash(changed.semanticPayload)).toBe(reviewPayloadHash(baseline.semanticPayload));
  }
  if (kind === "value") {
    const changed = await build(renamed, "CB-RENAMED", kind);
    expect(buildRemovalSourceDescription(changed.candidateSourceDocuments[0].binding!))
      .toBe("Noma role: Emissions entry. Lineage: Emissions entry, Site electricity, 2026-01-02, CB-RENAMED.");
    expect(changed.sourceBindingPlan[0].lineage.entityLabel).toContain("Site electricity");
  }
  expect(payloadHash((await build(original, "CB-001", kind, 2)).semanticPayload)).not.toBe(payloadHash(baseline.semanticPayload));
  if (kind === "value") expect(payloadHash((await build(original, "CB-001", kind, 1, "replacement-document")).semanticPayload)).not.toBe(payloadHash(baseline.semanticPayload));
});

it("keeps carried batch, component and earlier Removal labels out of both hashes", async () => {
  const baseline = await build(observation("Electricity"), "CB-001", "value", 1, "document", "RM-001");
  for (const [component, batch, removal] of [
    ["Site electricity", "CB-001", "RM-001"],
    ["Electricity", "CB-RENAMED", "RM-001"],
    ["Electricity", "CB-001", "RM-RENAMED"],
    ["Site electricity", "CB-RENAMED", "RM-RENAMED"],
  ]) {
    const changed = await build(observation(component), batch, "value", 1, "document", removal);
    expect(payloadHash(changed.semanticPayload)).toBe(payloadHash(baseline.semanticPayload));
    expect(reviewPayloadHash(changed.semanticPayload)).toBe(reviewPayloadHash(baseline.semanticPayload));
    expect(buildRemovalSourceDescription(changed.candidateSourceDocuments[0].binding!)).toContain(batch);
    expect(changed.datapointBodyByKey.get("entry-component::electricity_use")?.description).toContain(removal);
  }
});

it("leaves the carriedEntries key out of payloads that carry none", async () => {
  const without = await build(observation("Electricity"), "CB-001", "value");
  expect(without.semanticPayload).not.toHaveProperty("carriedEntries");
  const { carriedEntries: _absent, ...rest } = without.semanticPayload as Record<string, unknown>;
  expect(payloadHash(without.semanticPayload)).toBe(payloadHash(rest));
  const withCarried = await build(observation("Electricity"), "CB-001", "value", 1, "document", "RM-001");
  expect((withCarried.semanticPayload as Record<string, unknown>).carriedEntries).toEqual(
    normalizeCarriedEntriesForHash([{ entryId: "entry", creditBatchId: "batch", creditBatchCode: "CB-001", componentId: "entry-component",
      componentName: "Electricity", occurredOn: "2026-01-02", value: { magnitude: "2", unit: "kWh" },
      evidenceDocumentIds: ["document"], earlierRemovalId: "earlier-removal", earlierRemovalCode: "RM-001" }]),
  );
});

it("hashes carried semantic fields and canonical evidence order", () => {
  const entry = { entryId: "entry", creditBatchId: "batch", componentId: "component", occurredOn: "2026-01-02",
    value: { magnitude: "2", unit: "kWh" }, evidenceDocumentIds: ["b", "a"], earlierRemovalId: "earlier",
    creditBatchCode: "CB-001", componentName: "Electricity", earlierRemovalCode: "RM-001" };
  const baseline = { carriedEntries: normalizeCarriedEntriesForHash([entry]) };
  expect(baseline.carriedEntries?.[0]).toEqual({ entryId: "entry", creditBatchId: "batch", componentId: "component",
    occurredOn: "2026-01-02", value: entry.value, evidenceDocumentIds: ["a", "b"], earlierRemovalId: "earlier" });
  const reordered = { carriedEntries: normalizeCarriedEntriesForHash([{ ...entry, evidenceDocumentIds: ["a", "b"] }]) };
  expect(payloadHash(reordered)).toBe(payloadHash(baseline));
  for (const patch of [
    { entryId: "other" }, { creditBatchId: "other" }, { componentId: "other" }, { occurredOn: "2026-01-03" },
    { value: { magnitude: "3", unit: "kWh" } }, { evidenceDocumentIds: ["a"] }, { earlierRemovalId: "other" },
  ]) {
    const changed = { carriedEntries: normalizeCarriedEntriesForHash([{ ...entry, ...patch }]) };
    expect(payloadHash(changed)).not.toBe(payloadHash(baseline));
    expect(reviewPayloadHash(changed)).not.toBe(reviewPayloadHash(baseline));
  }
  expect(entry.evidenceDocumentIds).toEqual(["b", "a"]);
});
