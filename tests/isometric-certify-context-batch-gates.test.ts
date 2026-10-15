import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import { makeTestOrgContext } from "./helpers/test-org";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCertifierProjectByFacility,
} from "@/data-access/certification";
import { hasCertifierCredentials } from "@/data-access/certifier-credentials";
import { getChainOfCustodyData } from "@/data-access/chain-of-custody";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import {
  getCreditBatchById,
  getCreditBatchActiveScopeRemovalId,
} from "@/data-access/credit-batches";
import {
  listDocumentsForEntityIds,
} from "@/data-access/documents";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getCreditBatchesWithSamples } from "@/data-access/credit-batch-samples";
import { getTransportLegsWithEvidenceForEntities } from "@/data-access/transport-legs";
import {
  loadCertifyContextForCreditBatchForUser,
} from "@/fn/certification/certify-context-core";
import {
  mockNormalizedLineageFacts,
} from "./fixtures/certify-context";

vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchById: vi.fn(),
  getCreditBatchActiveScopeRemovalId: vi.fn(),
}));

vi.mock("@/data-access/certification", () => ({
  getCertifierProjectByFacility: vi.fn(),
}));

vi.mock("@/data-access/certifier-credentials", () => ({
  resolveIsometricClient: vi.fn(async () => ({} as import("@/lib/isometric").IsometricClient)),
  hasCertifierCredentials: vi.fn(),
}));

vi.mock("@/data-access/chain-of-custody", async () => {
  const actual = await vi.importActual<
    typeof import("@/data-access/chain-of-custody")
  >("@/data-access/chain-of-custody");
  return { ...actual, getChainOfCustodyData: vi.fn() };
});

vi.mock("@/data-access/credit-batch-accounting", () => ({
  loadCreditBatchRollups: vi.fn(),
}));

vi.mock("@/data-access/production-runs", () => ({
  getProductionRunsForCertification: vi.fn(),
}));

vi.mock("@/data-access/credit-batch-samples", () => ({
  getCreditBatchesWithSamples: vi.fn(),
}));

vi.mock("@/data-access/documents", () => ({
  listDocumentsForEntityIds: vi.fn(),
}));

vi.mock("@/data-access/biochar-delivery-transport", () => ({
  loadBiocharDeliveryTransportLegs: vi.fn(),
}));

vi.mock("@/data-access/transport-legs", () => ({
  getTransportLegsWithEvidenceForEntities: vi.fn(),
}));

vi.mock("@/lib/isometric", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/isometric")>("@/lib/isometric");
  return {
    ...actual,
    listProjects: vi.fn(),
    listGhgEntryTemplates: vi.fn(),
    listComponentBlueprints: vi.fn(),
  };
});

const mockedGetCreditBatch = vi.mocked(getCreditBatchById);
const mockedGetCreditBatchRemovalId = vi.mocked(
  getCreditBatchActiveScopeRemovalId,
);
const mockedGetMapping = vi.mocked(getCertifierProjectByFacility);
const mockedHasCredentials = vi.mocked(hasCertifierCredentials);
const mockedGetLineage = vi.mocked(getChainOfCustodyData);
const mockedLoadAccounting = vi.mocked(loadCreditBatchRollups);
const mockedGetRuns = vi.mocked(getProductionRunsForCertification);
const mockedGetBatchesWithSamples = vi.mocked(getCreditBatchesWithSamples);
const mockedListDocuments = vi.mocked(listDocumentsForEntityIds);
const mockedGetLegs = vi.mocked(getTransportLegsWithEvidenceForEntities);

const USER_ID = "user-1";
const CREDIT_BATCH_ID = "cb-1";
const FACILITY_ID = "fac-1";

describe("credit batch gates without applications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
    mockNormalizedLineageFacts(mockedLoadAccounting, mockedGetCreditBatch, mockedGetLineage);
    mockedHasCredentials.mockResolvedValue(true);
    mockedGetCreditBatchRemovalId.mockResolvedValue(null);
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      productionRunIds: [],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetLineage.mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof getChainOfCustodyData>>,
    );
    mockedGetRuns.mockResolvedValue([]);
    mockedGetBatchesWithSamples.mockResolvedValue([]);
    mockedListDocuments.mockResolvedValue([]);
    mockedGetLegs.mockResolvedValue([]);
  });

  it("evaluates batch and facility gates even when no applications are linked", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      productionRunIds: [],
      durabilityOption: "200_year",
      sampling: "sampled",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetBatchesWithSamples.mockResolvedValue([
      {
        creditBatchId: CREDIT_BATCH_ID,
        creditBatchCode: "CB-1",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        facilityTimezone: "UTC",
        sampling: "sampled",
        hasLabReport: false,
        durabilityOption: "200_year",
        samples: [],
        runs: [],
      },
    ] as unknown as Awaited<ReturnType<typeof getCreditBatchesWithSamples>>);
    mockedGetMapping.mockResolvedValue(null);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result.productionReadinessGap).toMatchObject({
      kind: "noProductionRuns",
      detail:
        "No completed production runs are linked to this credit batch. Complete a matching production run to continue.",
      fixTarget: "productionRuns",
    });
    expect(result.durabilityGateBlockers).toEqual([
      "Credit batch CB-1 is marked as sampled but has no Samples. Add at least 3 Samples before submitting.",
      "Set this facility's reference soil temperature under Certification settings, then Emissions, before submitting a 200-year Removal.",
    ]);
    expect(result.memberBatches[0]?.facilityEmissionsGateBlockers).toEqual([
      "Set this facility's reference soil temperature under Certification settings, then Emissions, before submitting a 200-year Removal.",
    ]);
    expect(result.memberBatches[0]?.hasLabReport).toBe(false);
    expect(toBatchHealthFacts(result, CREDIT_BATCH_ID).warnings).toEqual([
      "Credit batch CB-1 has no lab report document. Upload a lab report to one of its Samples. You can still submit the Removal.",
    ]);
    expect(result.submissionWarnings).toEqual([]);
    expect(mockedGetBatchesWithSamples).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String) }),
      [CREDIT_BATCH_ID],
    );
  });

});
