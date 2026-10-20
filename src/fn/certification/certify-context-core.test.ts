import { beforeEach, expect, it, vi } from "vitest";
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
    hasOrgCredentials: true, mapping: { externalProjectId: template.project_id },
    templatesById: { [template.id]: {
      template, observation: { lineSources },
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
vi.mock("@/data-access/removal-codes", () => ({ getRemovalCodes: vi.fn(async () => new Map()) }));
vi.mock("./batch-emission-context", () => ({ loadBatchEmissionContext: vi.fn(async () => ({})) }));
vi.mock("@/data-access/emission-entry-contenders", () => ({ loadEmissionEntryReservations: vi.fn(async () => []) }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: vi.fn(() => false), requireEmissionsEntriesEnabled: vi.fn() }));
vi.mock("@/data-access/certification", () => ({ listRecentSyncEvents: vi.fn(async () => []) }));
vi.mock("@/data-access/certifier-removals", () => ({ listRemovalsForFacility: vi.fn(), listUngroupedCreditBatches: vi.fn(async () => []), getCertifierRemovalById: vi.fn() }));
vi.mock("@/data-access/emission-entries", () => ({ listEmissionEntriesForBatches: vi.fn(async () => []) }));
vi.mock("@/data-access/emission-zeros", () => ({ isRemovalZeroEditable: vi.fn(async () => true) }));
vi.mock("./biochar-application-source-readback", () => ({ refreshRemovalEvidenceLinks: vi.fn(async () => []) }));
vi.mock("../with-action", () => ({ withAction: async (fn: (org: typeof ctx) => unknown) => ({ success: true, data: await fn(ctx) }) }));
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import { listRemovalsForFacility, getCertifierRemovalById } from "@/data-access/certifier-removals";
import { loadBatchEmissionContext } from "./batch-emission-context";
import { loadCertificationOverview } from "./overview";
import { loadRemovalEmptyLines } from "./removal-empty-lines-core";

it.each([new Date(0), new Date()])("loads context, Empty lines and overview after an unreserved draft entry changes (lock %s)", async (lockedAt) => {
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(true);
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
  vi.mocked(loadBatchEmissionContext).mockResolvedValue({ "batch-1": { entries: [{ id: "entry", componentId: "removed-line", creditBatchId: "batch-1",
    kind: "value", contentRevision: 2, counts: false, values: [], evidenceDocumentIds: [], occurredOn: "2026-01-02" }],
    previousObservations: new Map(), automaticFigures: {} } } as never);
  await expect(loadRemovalSubmissionContext(ctx, "removal-1")).resolves.toMatchObject({ latestSubmission: { id: "crashed" } });
  await expect(loadRemovalEmptyLines(ctx, "removal-1")).resolves.toMatchObject({ editable: true, batches: expect.any(Array) });
  await expect(loadCertificationOverview(scope.facilityId)).resolves.toMatchObject({ success: true, data: { removals: [{ removalId: scope.removalId }] } });
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(false);
});
