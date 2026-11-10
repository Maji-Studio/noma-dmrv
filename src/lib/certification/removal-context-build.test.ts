import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeContext, setDurabilityMeasurementSamplesEnabled } from "../../../tests/fixtures/submit-removal-orchestrator";
import { make1000YearSequestrationTemplate, makeTemplate } from "../../../tests/fixtures/submit-removal-templates";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { buildRemovalContext } from "./removal-context-build";
import { loadDurabilityBatchData } from "./durability-readiness";
import { DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE } from "./durability-measurement-samples";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import type { RemovalScope } from "./removal-scope";

vi.mock("@/lib/certification/batch-emission-context", () => ({ loadBatchEmissionContext: vi.fn(async () => ({ batchFacts: {} })) }));
vi.mock("@/data-access/removal-codes", () => ({ getRemovalCodes: vi.fn(async () => new Map()) }));
vi.mock("@/lib/certification/durability-readiness", () => ({ loadDurabilityBatchData: vi.fn() }));

beforeEach(() => setDurabilityMeasurementSamplesEnabled(false));
afterEach(() => setDurabilityMeasurementSamplesEnabled(false));

it.each([
  { enabled: false, hasDurability: true, blocked: true },
  { enabled: true, hasDurability: true, blocked: false },
  { enabled: false, hasDurability: false, blocked: false },
  { enabled: true, hasDurability: false, blocked: false },
])("derives availability with samples enabled=$enabled, durability components=$hasDurability", async ({ enabled, hasDurability, blocked }) => {
  setDurabilityMeasurementSamplesEnabled(enabled);
  const template = hasDurability ? make1000YearSequestrationTemplate() : makeTemplate();
  const ctx = makeContext(undefined, { removalTemplate: template });
  const batchesWithSamples = ctx.batchesWithSamples.map(batch => ({ ...batch, durabilityOption: "1000_year" as const }));
  vi.mocked(loadDurabilityBatchData).mockResolvedValue({
    batchesWithSamples, blockers: [], warnings: [], blockersByBatchId: {}, blockerFactsByBatchId: {},
  });
  const scope: RemovalScope = {
    facilityId: ctx.facilityId, removalId: null, removal: null, lineages: [], feedstockCodes: {},
    memberBatches: ctx.memberBatches.map(batch => ({
      ...batch, removalTemplateId: template.id,
      productionRunIds: [], completedProductionRunIds: [], productionFeedstockIds: [],
      applicationIds: [], applicationSlices: [], productionEmissionsClaimedByRemovalId: null,
    })),
  };
  const facilityFacts = {
    facilityTimezone: "UTC", hasOrgCredentials: true, mapping: ctx.mapping,
    templatesById: { [template.id]: {
      template, observation: { lineSources: ctx.lineSources },
      enrichmentProblems: [], lineSourceProblems: [], blueprintsForTemplate: ctx.blueprintsForTemplate,
      unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransportCategories: [],
    } },
  } as unknown as FacilityCertifierFacts;
  const result = await buildRemovalContext(makeTestOrgContext(), scope, facilityFacts, { correctionRead: true });
  const expected = blocked ? [DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE] : [];
  expect(result.durabilityConfigurationBlockers).toEqual(expected);
  expect(result.durabilityConfigurationFacts).toEqual(expected);
});
