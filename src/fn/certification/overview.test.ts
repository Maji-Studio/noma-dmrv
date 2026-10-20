import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import type { BatchEmissionLine } from "@/lib/certification/emission-lines";
import type { BatchHealth } from "@/lib/certification/batch-health";
import { buildDurabilityBatchSummaries } from "@/lib/certification/durability-batch-summary";
import { buildCreditBatchOpenItems } from "@/lib/credit-batches/open-items";
import { overviewBadgeCount } from "@/lib/credit-batches/batch-page";

// No database module or external service is used by this action unit suite.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { ISOMETRIC_ENVIRONMENT: "sandbox" } }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
vi.mock("@/data-access/removal-codes", () => ({ getRemovalCodes: vi.fn(async () => new Map()) }));
vi.mock("@/data-access/credit-batch-certification-links", () => ({ listCreditBatchCertificationLinks: vi.fn() }));
vi.mock("@/data-access/record-certification-lock", () => ({ getRecordLocksForTargets: vi.fn(async () => []) }));
vi.mock("@/data-access/certification", () => ({ getLatestSubmissionsForEntities: vi.fn(async () => new Map()) }));
vi.mock("@/data-access/certifier-removals", () => ({}));
vi.mock("@/data-access/credit-batch-samples", () => ({ getCreditBatchesWithSamples: vi.fn() }));
vi.mock("./certify-context-core", () => ({ buildCreditBatchContexts: vi.fn(), loadFacilityCertifierFacts: vi.fn() }));
vi.mock("./biochar-application-source-readback", () => ({}));
vi.mock("@/lib/certification/batch-health", () => ({ deriveBatchHealth: vi.fn(), batchLinesToDecide: vi.fn() }));
vi.mock("@/lib/certification/batch-health-facts", () => ({ toBatchHealthFacts: vi.fn() }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: vi.fn() }));
vi.mock("@/lib/read-models/batches-emission-lines", () => ({ loadBatchesEmissionLines: vi.fn() }));

import { requireOrgContext } from "@/lib/auth/server";
import { requireOrgFacility } from "@/data-access/utils";
import { listCreditBatchCertificationLinks } from "@/data-access/credit-batch-certification-links";
import { getCreditBatchesWithSamples } from "@/data-access/credit-batch-samples";
import { batchLinesToDecide, deriveBatchHealth } from "@/lib/certification/batch-health";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { loadBatchesEmissionLines } from "@/lib/read-models/batches-emission-lines";
import { buildCreditBatchContexts } from "./certify-context-core";
import { loadCreditBatchHealthSummaries } from "./overview";

const LINES_TO_DECIDE = 3;
const ctx = makeTestOrgContext();
const facilityId = "10000000-0000-4000-8000-000000000000";
const ids = ["20000000-0000-4000-8000-000000000000", "30000000-0000-4000-8000-000000000000"];
const health: BatchHealth = {
  state: "incomplete", issueCount: 1, documentWarnings: ["labReport", "labReport"],
  checks: [{ key: "production", label: "Production", requirementLabel: "Production", unmetLabel: "No production", status: "unmet" }],
};
const batches = ids.map((id) => ({ id, facilityId, removalTemplateId: "template", removalId: null }));
const sampling = ids.map((creditBatchId, index) => ({
  creditBatchId, creditBatchCode: `CB-${index}`, sampling: "sampled" as const,
  durabilityOption: "1000_year" as const, facilityTimezone: "UTC", runs: [],
  samples: index ? [] : [
    { id: "outlier", sampleCode: "S-1", hToCOrgRatio: 0.6, oToCOrgRatio: 0.1 },
    { id: "unpaired", sampleCode: "S-2", hToCOrgRatio: 0.3, oToCOrgRatio: null },
  ],
}));
const emissionLines = [{ componentId: "diesel", displayName: "Diesel", state: "needsReview" }] as BatchEmissionLine[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(true);
  vi.mocked(listCreditBatchCertificationLinks).mockResolvedValue(batches as never);
  vi.mocked(buildCreditBatchContexts).mockResolvedValue({ contextsByBatch: Object.fromEntries(ids.map(id => [id, { facilityId }])) } as never);
  vi.mocked(deriveBatchHealth).mockReturnValue(health);
  vi.mocked(batchLinesToDecide).mockReturnValue(LINES_TO_DECIDE);
  vi.mocked(getCreditBatchesWithSamples).mockResolvedValue(sampling as never);
  vi.mocked(loadBatchesEmissionLines).mockResolvedValue(new Map([
    [ids[0], { lines: emissionLines, storedEntries: [] }],
    [ids[1], { lines: undefined, storedEntries: [] }],
  ]) as never);
});

it("uses the page builder for document, outlier, unpaired and emission Check items with bulk reads", async () => {
  const result = await loadCreditBatchHealthSummaries(facilityId, ids);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("Expected summaries");
  const durability = buildDurabilityBatchSummaries(sampling as never);
  const pageItems = buildCreditBatchOpenItems({ facilityId, creditBatchId: ids[0], health,
    durability: durability[0], emissionLines });
  expect(pageItems.check.map(item => item.id)).toEqual([
    "document:lab-report", "outlier:S-1", "unpaired:S-2", "emission:diesel",
  ]);
  expect(result.data[ids[0]]).toMatchObject({ issueCount: 1, checkCount: 4, linesToDecide: LINES_TO_DECIDE });
  expect(batchLinesToDecide).toHaveBeenCalledWith(health);
  expect(result.data[ids[0]].issueCount + result.data[ids[0]].checkCount).toBe(overviewBadgeCount(pageItems));
  // A sibling with no derivable lines still gets its document warning.
  expect(result.data[ids[1]].checkCount).toBe(1);
  expect(getCreditBatchesWithSamples).toHaveBeenCalledExactlyOnceWith(ctx, ids);
  expect(loadBatchesEmissionLines).toHaveBeenCalledExactlyOnceWith(ctx, batches);
  expect(requireOrgFacility).toHaveBeenCalledWith(ctx, facilityId);
});

it("excludes emission Check items and skips their bulk reads when the page flag is off", async () => {
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(false);
  const result = await loadCreditBatchHealthSummaries(facilityId, ids);
  expect(result).toMatchObject({ success: true, data: { [ids[0]]: { checkCount: 3 } } });
  expect(loadBatchesEmissionLines).not.toHaveBeenCalled();
});

it("keeps the request bound and rejects foreign batches before loading Check inputs", async () => {
  expect(await loadCreditBatchHealthSummaries(facilityId, Array.from({ length: 51 }, () => ids[0])))
    .toMatchObject({ success: false });
  vi.mocked(listCreditBatchCertificationLinks).mockResolvedValue([{ ...batches[0], facilityId: "foreign" }] as never);
  expect(await loadCreditBatchHealthSummaries(facilityId, ids)).toMatchObject({ success: false });
  expect(getCreditBatchesWithSamples).not.toHaveBeenCalled();
  expect(loadBatchesEmissionLines).not.toHaveBeenCalled();
});
