import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { makeTestOrgContext } from "./helpers/test-org";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as readings from "@/data-access/production-run-readings";
import * as runReadings from "@/data-access/production-runs/readings";
import * as readingImports from "@/data-access/production-run-reading-imports";
import * as readingsActions from "@/fn/production-run-readings";
import * as readingImportActions from "@/fn/production-run-reading-imports";
import * as readingsCsv from "@/lib/production-readings/readings-csv";
import { deriveRemovalReadiness } from "@/lib/certification/readiness";
import {
  getCertifierProjectByFacility,
  type CertifierProjectRow,
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
  listComponentBlueprints,
  listProjects,
  listGhgEntryTemplates,
  type IsometricProject,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import {
  loadCertifyContextForCreditBatchForUser,
} from "@/fn/certification/certify-context-core";
import {
  mockNormalizedLineageFacts,
} from "./fixtures/certify-context";

vi.mock("@/data-access/production-run-readings");
vi.mock("@/data-access/production-runs/readings");
vi.mock("@/data-access/production-run-reading-imports");
vi.mock("@/fn/production-run-readings");
vi.mock("@/fn/production-run-reading-imports");
vi.mock("@/lib/production-readings/readings-csv");

const readingsFunctions = [readings, runReadings, readingImports, readingsActions,
  readingImportActions, readingsCsv].flatMap((module) => Object.values(module));

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
const mockedListProjects = vi.mocked(listProjects);
const mockedListTemplates = vi.mocked(listGhgEntryTemplates);
const mockedListBlueprints = vi.mocked(listComponentBlueprints);

const USER_ID = "user-1";
const CREDIT_BATCH_ID = "cb-1";
const FACILITY_ID = "fac-1";
const EXTERNAL_PROJECT_ID = "prj_test";

function mapping(
  overrides: Partial<CertifierProjectRow> = {},
): CertifierProjectRow {
  return {
    id: "cert-proj-1",
    facilityId: FACILITY_ID,
    provider: "isometric",
    externalProjectId: EXTERNAL_PROJECT_ID,
    protocolSlug: "biochar",
    protocolVersion: "1.2",
    defaultRemovalTemplateId: null,
    webhookSecret: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CertifierProjectRow;
}

function project(id: string): IsometricProject {
  return { id, name: `Project ${id}` } as IsometricProject;
}

function template(
  id: string,
  blueprintKeys: string[] = [],
): IsometricGhgEntryTemplate {
  return {
    id,
    name: `Template ${id}`,
    groups: [
      {
        id: `${id}-group-1`,
        key: `${id}-group-1`,
        name: "Group",
        components: blueprintKeys.map((key, idx) => ({
          id: `${id}-comp-${idx}`,
          blueprint_key: key,
          inputs: [],
        })),
      },
    ],
  } as unknown as IsometricGhgEntryTemplate;
}

describe("loadCertifyContextForCreditBatchForUser", () => {
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

  it("is ready through the real loader when all readings modules throw (#627)", async () => {
    for (const fn of readingsFunctions) {
      vi.mocked(fn).mockImplementation(() => {
        throw new Error("Certify readiness must not load structured readings");
      });
    }
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID, code: "CB-1", facilityId: FACILITY_ID,
      productionRunIds: ["pr-1"], durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(mapping({ defaultRemovalTemplateId: "tpl_ready" }));
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([template("tpl_ready")]);
    mockedListBlueprints.mockResolvedValue([]);
    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: {
        id: "app-1", code: "APP-1", biocharAppliedDryTons: 0.035,
        applicationDate: new Date("2026-01-20T00:00:00Z"),
      } as never,
      delivery: { id: "del-1", proofOfDeliveryCount: 1, customerLocationId: "loc-1" } as never,
      order: null,
      biocharProduct: { id: "bp-1", linkedProductionRunId: "pr-1" } as never,
      productionRun: { id: "pr-1", code: "PR-1" } as never,
      reactor: null, feedstocks: [], warnings: [],
    } as Awaited<ReturnType<typeof getChainOfCustodyData>>);
    mockedGetRuns.mockResolvedValue([{
      id: "pr-1", code: "PR-1", status: "complete", hasReadingsFile: true,
      startTime: new Date("2026-01-05T00:00:00Z"),
      endTime: new Date("2026-01-05T12:00:00Z"),
      feedstockWetMassKg: 100, feedstockMoisturePercent: 10,
      biocharOutputKg: 40, biocharMoisturePercent: 12, biocharDryMassKg: 35,
      dieselOperationLiters: 0, preprocessingFuelLiters: 0,
      dieselGensetLiters: 0, electricityKwh: 0, samples: [],
    } as never]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID), CREDIT_BATCH_ID,
    );

    expect(mockedGetRuns).toHaveBeenCalledWith(makeTestOrgContext(USER_ID), ["pr-1"]);
    expect(result.entityReadinessGaps).toEqual([]);
    expect(deriveRemovalReadiness(toRemovalReadinessFacts(result))).toMatchObject({
      state: "ready", reasons: [],
    });
    for (const fn of readingsFunctions) expect(fn).not.toHaveBeenCalled();
  });
});
