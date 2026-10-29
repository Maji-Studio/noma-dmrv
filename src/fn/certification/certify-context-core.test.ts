vi.mock("./removal-correction-core", () => ({ loadRemovalEntryCorrection: vi.fn(async () => ({ windowOpen: false, correctionNeeded: false, changedComponentIds: [], message: null })) }));
import { beforeEach, expect, it, vi } from "vitest";
import { collectFutureDatedMeasurements } from "./future-dated-measurements";

import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { getTransportLegsWithEvidenceForEntities } from "@/data-access/transport-legs";
import { normalizeTemplateDefinition, resolveLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import type { RemovalScope } from "./removal-scope";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { deriveRequiredTransportCategories } from "./certify-transport-coverage";
import { loadFacilityCertifierFacts } from "./facility-certifier-facts";
import { resolveScopeForRemoval } from "./removal-scope";
import { buildRemovalContext, loadRemovalSubmissionContext } from "./certify-context-core";

vi.mock("./facility-certifier-facts", () => ({ loadFacilityCertifierFacts: vi.fn() }));
vi.mock("./removal-scope", () => ({ resolveScopeForRemoval: vi.fn() }));
vi.mock("@/data-access/biochar-delivery-transport", () => ({ loadBiocharDeliveryTransportLegs: vi.fn() }));
vi.mock("@/data-access/transport-legs", () => ({ getTransportLegsWithEvidenceForEntities: vi.fn() }));
vi.mock("@/data-access/certification-submissions", () => ({ getLatestSubmission: vi.fn(async () => null), hasFinalizedSubmission: vi.fn(async () => false) }));
vi.mock("@/data-access/production-runs", () => ({ getProductionRunsForCertification: vi.fn(async () => []) }));
vi.mock("./linked-ghg-statement-status", () => ({ loadLinkedGhgStatementStatus: vi.fn(async () => null) }));
vi.mock("./evidence-mirror-summary", () => ({ loadEvidenceMirrorSummaryForScope: vi.fn(async () => []) }));
vi.mock("./durability-readiness", () => ({ loadDurabilityBatchData: vi.fn(async () => ({ batchesWithSamples: [], blockers: [], warnings: [], blockersByBatchId: {} })) }));
vi.mock("./certify-entity-readiness", () => ({ buildCertifyEntityReadiness: vi.fn(async () => ({ gaps: [], warnings: [], issues: [] })) }));
vi.mock("./certify-lineage-blockers", () => ({ buildSubmissionLineageBlockers: vi.fn(() => []) }));
vi.mock("./future-dated-measurements", () => ({ collectFutureDatedMeasurements: vi.fn(() => []) }));
vi.mock("@/lib/certification/production-readiness-from-lineage", () => ({ productionReadinessGapForScope: vi.fn(() => null) }));
vi.mock("@/lib/certification/mass-accounting", () => ({ buildMassAccounting: vi.fn(() => ({ attributionByRunId: new Map(), runSummary: {} })), EMPTY_RUN_SUMMARY: {} }));
vi.mock("./member-credit-batch", () => ({ toMemberCreditBatchView: vi.fn((batch) => batch) }));
vi.mock("./production-claim-transport-scope", () => ({
  collectProductionClaimAwareRequiredTransportCategories: vi.fn((input) => input.requiredTransportCategories),
  collectProductionClaimAwareTransportEntityIds: vi.fn(() => ({ feedstockIds: ["feedstock-1"], biocharProductIds: ["product-1"], sampleIds: [] })),
}));

const ctx = makeTestOrgContext();
const scope = {
  facilityId: "facility-1", removalId: "removal-1", removal: null,
  memberBatches: [{ id: "batch-1", code: "CB-1", removalTemplateId: fixture.id,
    productionRunIds: [], completedProductionRunIds: [], applicationIds: ["application-1"], applicationSlices: [],
    productionEmissionsClaimedByRemovalId: null,
  }],
  lineages: [{ delivery: { id: "delivery-1" }, application: { biocharAppliedTons: 1, applicationDate: new Date("2026-10-01") } }],
} as unknown as RemovalScope;

function facts(template: GhgEntryTemplate): FacilityCertifierFacts {
  const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
  return {
    facilityTimezone: "UTC",
    hasOrgCredentials: true, mapping: { externalProjectId: template.project_id },
    templatesById: { [template.id]: {
      template, observation: { id: "observation", definition: normalizeTemplateDefinition(template), enrichment: {}, lineSources },
      enrichmentProblems: [], lineSourceProblems: [], blueprintsForTemplate: [], unresolvedBlueprintKeys: [],
      unbindableTemplateInputs: findUnbindableTemplateInputs(template, { lineSources }),
      requiredTransportCategories: deriveRequiredTransportCategories(template),
    } },
  } as unknown as FacilityCertifierFacts;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTransportLegsWithEvidenceForEntities).mockImplementation(async (_ctx, category) => category === "feedstock" ? [
    { id: "feedstock-leg", entityId: "feedstock-1", distanceKm: 10, loadMassKg: 1000 } as never,
  ] : []);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([
    { id: "delivery-leg", entityId: "delivery-1", distanceKm: 20, loadMassKg: 1000 } as never,
  ]);
});

it.each([
  ["biomass-feedstock-transport", "Feedstock transport"],
  ["biochar-transport", "Delivery transport"],
])("keeps recorded facts for the warning after %s disappears from the fixture", async (groupKey, label) => {
  const template = structuredClone(fixture) as GhgEntryTemplate;
  template.groups.find((group) => group.key === groupKey)!.components = [];
  const result = await buildRemovalContext(ctx, scope, facts(template));
  expect(result.submissionWarnings).toContainEqual(expect.stringContaining(`${label} is recorded`));
  expect(loadBiocharDeliveryTransportLegs).toHaveBeenCalledWith(ctx, [{ deliveryId: "delivery-1", loadMassKg: 1000 }]);
  if (groupKey === "biochar-transport") {
    expect(result.transportLegs.biochar).toEqual([]);
    expect(result.transportCoverage.biochar.count).toBe(0);
  }
});

it.each([false, true])("threads explicit submission enrichment freshness to facility facts (%s)", async (refreshEnrichment) => {
  vi.mocked(resolveScopeForRemoval).mockResolvedValue(scope);
  vi.mocked(loadFacilityCertifierFacts).mockResolvedValue(facts(fixture as GhgEntryTemplate));
  await loadRemovalSubmissionContext(ctx, "removal-1", { refreshEnrichment });
  expect(loadFacilityCertifierFacts).toHaveBeenCalledWith(ctx, scope.facilityId, { refreshEnrichment });
});

// These entry-enabled regressions run the real context and overview orchestration with DB seams mocked.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/data-access/utils", async (original) => ({ ...await original<typeof import("@/data-access/utils")>(), requireOrgFacility: vi.fn() }));
vi.mock("@/data-access/credit-batch-missing-production-runs", () => ({ loadCreditBatchesMissingProductionRuns: vi.fn(async () => new Map()) }));
vi.mock("@/data-access/removal-codes", () => ({ getRemovalCodes: vi.fn(async () => new Map()) }));
vi.mock("./batch-emission-context", () => ({ loadBatchEmissionContext: vi.fn(async () => ({ batchFacts: {} })) }));
vi.mock("@/data-access/emission-entry-contenders", () => ({ loadEmissionEntryReservations: vi.fn(async () => []) }));
vi.mock("@/data-access/certification", () => ({ listRecentSyncEvents: vi.fn(async () => []), listRemovalAttemptEvents: vi.fn(async () => []) }));
vi.mock("@/data-access/certifier-removals", () => ({ listRemovalsForFacility: vi.fn(), listUngroupedCreditBatches: vi.fn(async () => []), getCertifierRemovalById: vi.fn() }));
vi.mock("@/data-access/emission-entries", () => ({ listEmissionEntriesForBatches: vi.fn(async () => []) }));
vi.mock("@/data-access/emission-zeros", () => ({ isRemovalZeroEditable: vi.fn(async () => true) }));
vi.mock("./biochar-application-source-readback", () => ({ refreshRemovalEvidenceLinks: vi.fn(async () => []) }));
vi.mock("../with-action", () => ({ withAction: async (fn: (org: typeof ctx) => unknown) => ({ success: true, data: await fn(ctx) }) }));
import { loadCreditBatchesMissingProductionRuns } from "@/data-access/credit-batch-missing-production-runs";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import { listRemovalsForFacility, getCertifierRemovalById } from "@/data-access/certifier-removals";
import { loadBatchEmissionContext } from "./batch-emission-context";
import { loadCertificationOverview } from "./overview";
import { loadRemovalEmptyLines } from "./removal-empty-lines-core";

it.each([new Date(0), new Date()])("loads context, Empty lines and overview after an unreserved draft entry changes (lock %s)", async (lockedAt) => {
  const template = structuredClone(fixture) as GhgEntryTemplate;
  const facility = facts(template);
  const observation = facility.templatesById[template.id]!.observation!;
  Object.assign(observation, { id: "observation", definition: normalizeTemplateDefinition(template), enrichment: {} });
  const removal = { id: scope.removalId, code: "RM-1", metadata: null, updatedAt: new Date() };
  const currentScope = { ...scope, removal, memberBatches: scope.memberBatches.map((batch) => ({ ...batch, startDate: "2026-01-01" })) } as RemovalScope;
  vi.mocked(resolveScopeForRemoval).mockResolvedValue(currentScope);
  vi.mocked(loadFacilityCertifierFacts).mockResolvedValue(facility);
  vi.mocked(listRemovalsForFacility).mockResolvedValue([removal] as never);
  vi.mocked(getCertifierRemovalById).mockResolvedValue(removal as never);
  vi.mocked(getLatestSubmission).mockResolvedValue({ id: "crashed", status: "draft", lockedAt, metadata: null,
    payloadSnapshot: { frozenEntrySet: [{ entryId: "entry", contentRevision: 1 }] } } as never);
  vi.mocked(loadBatchEmissionContext).mockResolvedValue({ batchFacts: { "batch-1": { entries: [{ id: "entry", componentId: "removed-line", creditBatchId: "batch-1",
    kind: "value", contentRevision: 2, counts: false, values: [], evidenceDocumentIds: [], occurredOn: "2026-01-02" }],
    previousObservations: new Map(), automaticFigures: {} } } } as never);
  await expect(loadRemovalSubmissionContext(ctx, "removal-1")).resolves.toMatchObject({ latestSubmission: { id: "crashed" } });
  await expect(loadRemovalEmptyLines(ctx, "removal-1")).resolves.toMatchObject({ editable: true, batches: expect.any(Array) });
  await expect(loadCertificationOverview(scope.facilityId)).resolves.toMatchObject({ success: true, data: { removals: [{ removalId: scope.removalId }] } });
});

it.each(["Africa/Dar_es_Salaam", "America/Los_Angeles"])("passes the scoped facility zone to future measurement readiness (%s)", async (timezone) => {
  const result = await buildRemovalContext(ctx, scope, { ...facts(fixture as GhgEntryTemplate), facilityTimezone: timezone });
  expect(result.facilityTimezone).toBe(timezone);
  expect(collectFutureDatedMeasurements).toHaveBeenLastCalledWith(expect.objectContaining({ facilityTimezone: timezone }));
});

it("carries the facility zone when there are no applications", async () => {
  const timezone = "Africa/Dar_es_Salaam";
  const emptyScope = { ...scope, memberBatches: scope.memberBatches.map((batch) => ({ ...batch, applicationIds: [] })) };
  const result = await buildRemovalContext(ctx, emptyScope, { ...facts(fixture as GhgEntryTemplate), facilityTimezone: timezone });
  expect(result.facilityTimezone).toBe(timezone);
  expect(collectFutureDatedMeasurements).not.toHaveBeenCalled();
});


it.each([undefined, "claimed-draft"])("forwards the submission read scope for correction recovery: %s", async (claimedSubmissionId) => {
  vi.mocked(resolveScopeForRemoval).mockResolvedValue(scope);
  const facilityFacts = facts(fixture as GhgEntryTemplate);
  vi.mocked(loadFacilityCertifierFacts).mockResolvedValue(facilityFacts);
  await loadRemovalSubmissionContext(ctx, "removal-1", { claimedSubmissionId });
  expect(loadBatchEmissionContext).toHaveBeenCalledWith(ctx, scope.facilityId, scope.memberBatches, facilityFacts,
    expect.objectContaining({ claimedAttempt: { removalId: "removal-1", submissionId: claimedSubmissionId }, loadCorrection: expect.any(Function), ownedRemovalId: "removal-1" }));
});

it("suppresses correction projections while compiling the shared comparison", async () => {
  const facilityFacts = facts(fixture as GhgEntryTemplate);
  await buildRemovalContext(ctx, scope, facilityFacts, { correctionRead: true });
  expect(loadBatchEmissionContext).toHaveBeenCalledWith(ctx, scope.facilityId, scope.memberBatches, facilityFacts, expect.objectContaining({ loadCorrection: undefined, ownedRemovalId: scope.removalId ?? undefined }));
});

it("projects only held batches with uncovered runs into the Removal summary", async () => {
  const removal = { id: scope.removalId, code: "RM-1", metadata: null, updatedAt: new Date() };
  const memberBatches = ["held", "sent", "empty", "covered"].map(id => ({
    ...scope.memberBatches[0], id, code: `CB-${id}`,
  }));
  vi.mocked(resolveScopeForRemoval).mockResolvedValue({ ...scope, removal, memberBatches } as RemovalScope);
  vi.mocked(loadFacilityCertifierFacts).mockResolvedValue(facts(fixture as GhgEntryTemplate));
  vi.mocked(listRemovalsForFacility).mockResolvedValue([removal] as never);
  const run = { id: "run-1", code: "PR-1", startDate: "2026-09-09", createdAt: new Date("2026-10-01") };
  const missing = { sentRemovalCodes: [], heldRemovalCodes: [removal.code], batchStartDate: "2026-09-01",
    runs: [run], manualEntries: [] };
  vi.mocked(loadCreditBatchesMissingProductionRuns).mockResolvedValueOnce(new Map([
    ["held", missing],
    ["sent", { ...missing, sentRemovalCodes: ["RM-2"], heldRemovalCodes: [] }],
    ["empty", { ...missing, runs: [] }],
    ["covered", { ...missing, manualEntries: [{ occurredOn: run.startDate, createdAt: new Date("2026-10-02") }] }],
  ]));
  const result = await loadCertificationOverview(scope.facilityId);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error);
  expect(result.data.removals[0].missingProductionRuns).toEqual([
    { creditBatchId: "held", creditBatchCode: "CB-held", runs: [{ id: run.id, code: run.code }] },
  ]);
  expect(loadCreditBatchesMissingProductionRuns).toHaveBeenCalledExactlyOnceWith(ctx, memberBatches.map(batch => batch.id));
});
