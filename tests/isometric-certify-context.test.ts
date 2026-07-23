import { makeTestOrgContext } from "./helpers/test-org";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCertifierProjectByFacility,
  type CertifierProjectRow,
} from "@/data-access/certification";
import { hasCertifierCredentials } from "@/data-access/certifier-credentials";
import { getChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  type CreditBatchLineageFacts,
  loadCreditBatchAccounting,
} from "@/data-access/credit-batch-accounting";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getApplicationsForRuns } from "@/data-access/credit-batch-production-runs";
import {
  listDocumentsForEntityIds,
  type DocumentRow,
} from "@/data-access/documents";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import { getCreditBatchesWithSamples } from "@/data-access/credit-batch-samples";
import { getTransportLegsWithEvidenceForEntities } from "@/data-access/transport-legs";
import {
  listComponentBlueprints,
  listProjects,
  listGhgEntryTemplates,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import {
  loadCertifyContextForCreditBatchForUser,
} from "@/fn/certification/certify-context-core";
import { APPLICATION_VISUAL_EVIDENCE_ROLES } from "@/lib/certification/application-evidence";

vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchById: vi.fn(),
}));

vi.mock("@/data-access/credit-batch-production-runs", () => ({
  getApplicationsForRuns: vi.fn(),
}));

vi.mock("@/data-access/certification", () => ({
  getCertifierProjectByFacility: vi.fn(),
}));

vi.mock("@/data-access/certifier-credentials", () => ({
  hasCertifierCredentials: vi.fn(),
}));

vi.mock("@/data-access/chain-of-custody", async () => {
  const actual = await vi.importActual<
    typeof import("@/data-access/chain-of-custody")
  >("@/data-access/chain-of-custody");
  return { ...actual, getChainOfCustodyData: vi.fn() };
});

vi.mock("@/data-access/credit-batch-accounting", () => ({
  loadCreditBatchAccounting: vi.fn(),
}));

vi.mock("@/data-access/production-runs", () => ({
  getProductionRunsWithSamples: vi.fn(),
}));

vi.mock("@/data-access/credit-batch-samples", () => ({
  getCreditBatchesWithSamples: vi.fn(),
}));

vi.mock("@/data-access/documents", () => ({
  listDocumentsForEntityIds: vi.fn(),
}));

vi.mock("@/data-access/transport-legs", () => ({
  getTransportLegsWithEvidenceForEntities: vi.fn(),
}));

vi.mock("@/lib/isometric", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/isometric")>("@/lib/isometric");
  return {
    ...actual,
    getIsometricClientForOrg: vi.fn(async () => ({} as import("@/lib/isometric").IsometricClient)),
    listProjects: vi.fn(),
    listGhgEntryTemplates: vi.fn(),
    listComponentBlueprints: vi.fn(),
  };
});

const mockedGetCreditBatch = vi.mocked(getCreditBatchById);
const mockedGetApplicationsForRuns = vi.mocked(getApplicationsForRuns);
const mockedGetMapping = vi.mocked(getCertifierProjectByFacility);
const mockedHasCredentials = vi.mocked(hasCertifierCredentials);
const mockedGetLineage = vi.mocked(getChainOfCustodyData);
const mockedLoadAccounting = vi.mocked(loadCreditBatchAccounting);
const mockedGetRuns = vi.mocked(getProductionRunsWithSamples);
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
const APPLICATION_FOR_PR_1 = {
  applicationId: "app-1",
  productionRunId: "pr-1",
  biocharAppliedTons: 1,
};

function satisfiedVisualEvidenceDocuments(applicationId: string): DocumentRow[] {
  return APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => ({
    entityId: applicationId,
    documentType: "photo",
    uploadStatus: "uploaded",
    fileUrl: null,
    metadata: { geotagStatus: "present", evidenceRole: role },
  })) as unknown as DocumentRow[];
}

const DEFAULT_FACT_DATE = new Date("2026-01-20T00:00:00Z");

function factsFromMockedLineages(
  batchId: string,
  productionRunIds: string[],
  lineages: Awaited<ReturnType<typeof getChainOfCustodyData>>[],
): CreditBatchLineageFacts {
  const resolved = lineages.filter(Boolean);
  const runs = resolved.flatMap((lineage) =>
    lineage.productionRun
      ? [{
          id: lineage.productionRun.id,
          code: lineage.productionRun.code ?? "PR-1",
          status: lineage.productionRun.status ?? "complete",
          date: lineage.productionRun.date ?? DEFAULT_FACT_DATE,
          biocharDryMassKg: lineage.productionRun.biocharDryMassKg ?? 100,
          feedstockMassDryKg: lineage.productionRun.feedstockMassDryKg ?? 200,
          reactor: lineage.reactor
            ? {
                id: lineage.reactor.id,
                code: lineage.reactor.code ?? "R-1",
                identifier: lineage.reactor.identifier ?? "R-1",
                reactorType: lineage.reactor.reactorType ?? "fixed-bed",
              }
            : null,
          feedstocks: lineage.feedstocks.map((feedstock, index) => ({
            id: feedstock.id,
            code: feedstock.code ?? `FS-${index + 1}`,
            status: feedstock.status ?? "complete",
            deliveryDate: feedstock.deliveryDate ?? DEFAULT_FACT_DATE,
            massDryKg: feedstock.massDryKg ?? 100,
            massUsedKg: feedstock.massUsedKg ?? 100,
            eligibilityStatus: feedstock.eligibilityStatus ?? "eligible",
            supplierName: feedstock.supplierName ?? "Supplier",
            feedstockTypeName: feedstock.feedstockTypeName ?? "Wood",
            feedstockDeliveryCode: feedstock.feedstockDeliveryCode ?? null,
          })),
        }]
      : [],
  );
  const applications = resolved.map((lineage, index) => {
    const runId =
      lineage.productionRun?.id ?? productionRunIds[index] ?? "pr-1";
    return {
      id: lineage.application.id ?? `app-${index + 1}`,
      code: lineage.application.code ?? `APP-${index + 1}`,
      status: lineage.application.status ?? "complete",
      applicationDate: lineage.application.applicationDate ?? DEFAULT_FACT_DATE,
      fieldIdentifier: lineage.application.fieldIdentifier ?? null,
      evidenceMethod: lineage.application.evidenceMethod,
      gisBoundaryReference: lineage.application.gisBoundaryReference ?? null,
      biocharAppliedTons: lineage.application.biocharAppliedDryTons ?? 1,
      biocharAppliedDryTons: lineage.application.biocharAppliedDryTons ?? 1,
      soilTemperatureC: lineage.application.soilTemperatureC ?? 15,
      facility: lineage.facility,
      delivery: {
        id: lineage.delivery.id ?? `del-${index + 1}`,
        code: lineage.delivery.code ?? `D-${index + 1}`,
        status: lineage.delivery.status ?? "complete",
        deliveryDate: lineage.delivery.deliveryDate ?? DEFAULT_FACT_DATE,
        massDryKg: lineage.delivery.massDryKg ?? 100,
      },
      order: lineage.order
        ? {
            id: lineage.order.id,
            code: lineage.order.code ?? `O-${index + 1}`,
            orderDate: lineage.order.orderDate ?? DEFAULT_FACT_DATE,
            quantityKg: lineage.order.quantityKg ?? 100,
          }
        : null,
      biocharProduct: {
        id: lineage.biocharProduct?.id ?? `bp-${index + 1}`,
        code: lineage.biocharProduct?.code ?? `BP-${index + 1}`,
        status: lineage.biocharProduct?.status ?? "complete",
        productionDate:
          lineage.biocharProduct?.productionDate ?? DEFAULT_FACT_DATE,
        massKg: lineage.biocharProduct?.massKg ?? 100,
        moistureContentPercent:
          lineage.biocharProduct?.moistureContentPercent ?? 0,
        formulationName: lineage.biocharProduct?.formulationName ?? null,
        linkedProductionRunId:
          lineage.biocharProduct?.linkedProductionRunId ?? runId,
      },
    };
  });

  return {
    batchId,
    productionRunIds,
    runs: Array.from(new Map(runs.map((run) => [run.id, run])).values()),
    applications,
    applicationIds: applications.map((application) => application.id),
    appliedWeightTons: applications.reduce(
      (total, application) => total + application.biocharAppliedTons,
      0,
    ),
  };
}

function mockNormalizedLineageFacts(): void {
  mockedLoadAccounting.mockImplementation(async (ctx, batchIds) => {
    const entries = await Promise.all(
      batchIds.map(async (batchId) => {
        const batch = await mockedGetCreditBatch(ctx, batchId, {
          skipPreview: true,
        });
        const productionRunIds = batch?.productionRunIds ?? [];
        const applicationRows = await mockedGetApplicationsForRuns(
          ctx,
          productionRunIds,
        );
        const lineages = await Promise.all(
          applicationRows.map((application) =>
            mockedGetLineage(ctx, application.applicationId),
          ),
        );
        const lineageFacts = factsFromMockedLineages(
          batchId,
          productionRunIds,
          lineages,
        );
        return [
          batchId,
          {
            batch: {
              ...batch,
              id: batchId,
              code: batch?.code ?? "CB-1",
              facilityId: batch?.facilityId ?? FACILITY_ID,
              removalId: batch?.removalId ?? null,
              durabilityOption: batch?.durabilityOption ?? "200_year",
              productionEmissionsClaimedByRemovalId:
                batch?.productionEmissionsClaimedByRemovalId ?? null,
            },
            lineageFacts,
            appliedWeightTons: lineageFacts.appliedWeightTons,
            chemistry: {},
            co2ePreview: {},
          },
        ] as const;
      }),
    );
    return Object.fromEntries(entries) as never;
  });
}

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

function blueprint(key: string): IsometricComponentBlueprint {
  return {
    key,
    display_name: key,
    description: "",
    inputs: [],
  } as unknown as IsometricComponentBlueprint;
}

describe("loadCertifyContextForCreditBatchForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockNormalizedLineageFacts();
    mockedHasCredentials.mockResolvedValue(true);
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      productionRunIds: [],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetApplicationsForRuns.mockImplementation(async (_userId, runIds) =>
      runIds.includes("pr-1") ? [APPLICATION_FOR_PR_1] : [],
    );
    mockedGetLineage.mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof getChainOfCustodyData>>,
    );
    mockedGetRuns.mockResolvedValue([]);
    mockedGetBatchesWithSamples.mockResolvedValue([]);
    mockedListDocuments.mockResolvedValue([]);
    mockedGetLegs.mockResolvedValue([]);
  });

  it("returns the unlinked shape and skips remote calls when no certifier mapping exists", async () => {
    mockedGetMapping.mockResolvedValue(null);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result).toMatchObject({
      facilityId: FACILITY_ID,
      mapping: null,
      project: null,
      defaultTemplate: null,
      missingDefaultTemplateId: null,
      blueprintsForTemplate: [],
      unresolvedBlueprintKeys: [],
    });
    expect(mockedListProjects).not.toHaveBeenCalled();
    expect(mockedListTemplates).not.toHaveBeenCalled();
    expect(mockedListBlueprints).not.toHaveBeenCalled();
    expect(mockedGetLegs).not.toHaveBeenCalled();
  });

  it("reports missing organization credentials and skips remote calls", async () => {
    mockedGetMapping.mockResolvedValue(mapping());
    mockedHasCredentials.mockResolvedValue(false);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result).toMatchObject({
      hasOrgCredentials: false,
      mapping: { externalProjectId: EXTERNAL_PROJECT_ID },
      project: null,
      defaultTemplate: null,
    });
    expect(mockedListProjects).not.toHaveBeenCalled();
    expect(mockedListTemplates).not.toHaveBeenCalled();
    expect(mockedListBlueprints).not.toHaveBeenCalled();
  });

  it("returns linked-no-default shape when defaultRemovalTemplateId is null", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: null }),
    );
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([template("rvt_1")]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result.mapping?.externalProjectId).toBe(EXTERNAL_PROJECT_ID);
    expect(result.project?.id).toBe(EXTERNAL_PROJECT_ID);
    expect(result.defaultTemplate).toBeNull();
    expect(result.missingDefaultTemplateId).toBeNull();
    expect(result.blueprintsForTemplate).toEqual([]);
    expect(mockedListBlueprints).not.toHaveBeenCalled();
  });

  it("still walks production lineage when the default template is missing", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      productionRunIds: ["pr-1"],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: null }),
    );
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([template("rvt_1")]);
    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: {
        id: "app-1",
        code: "APP-1",
        // Same UTC month as the run start — no straddle advisory (issue #320).
        applicationDate: new Date("2026-01-20T00:00:00Z"),
        biocharAppliedDryTons: 1,
      } as never,
      delivery: { id: "del-1" } as never,
      order: null,
      biocharProduct: {
        id: "bp-1",
        code: "BP-1",
        linkedProductionRunId: "pr-1",
      } as never,
      productionRun: { id: "pr-1", code: "PR-1" } as never,
      reactor: null,
      feedstocks: [],
      warnings: [],
    } as Awaited<ReturnType<typeof getChainOfCustodyData>>);
    mockedGetRuns.mockResolvedValue([
      {
        id: "pr-1",
        code: "PR-1",
        status: "complete",
        // issue #320: buildSubmissionWarnings reads startTime for the month-straddle check.
        startTime: new Date("2026-01-05T00:00:00Z"),
        biocharDryMassKg: 1000,
        samples: [],
        readingsCount: 1,
      } as never,
    ]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result.defaultTemplate).toBeNull();
    expect(result.hasSubmittableRuns).toBe(true);
    expect(result.productionReadinessGap).toBeNull();
    expect(result.runSummary.runCount).toBe(1);
    expect(mockedGetLineage).toHaveBeenCalledWith(makeTestOrgContext(USER_ID), "app-1");
  });

  it("flags resolved production runs that have no telemetry readings", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      productionRunIds: ["pr-1"],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: null }),
    );
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([template("rvt_1")]);
    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: {
        id: "app-1",
        code: "APP-1",
        // Same UTC month as the run start — no straddle advisory (issue #320).
        applicationDate: new Date("2026-01-20T00:00:00Z"),
        biocharAppliedDryTons: 1,
      } as never,
      delivery: { id: "del-1" } as never,
      order: null,
      biocharProduct: {
        id: "bp-1",
        code: "BP-1",
        linkedProductionRunId: "pr-1",
      } as never,
      productionRun: { id: "pr-1", code: "PR-1" } as never,
      reactor: null,
      feedstocks: [],
      warnings: [],
    } as Awaited<ReturnType<typeof getChainOfCustodyData>>);
    mockedGetRuns.mockResolvedValue([
      {
        id: "pr-1",
        code: "PR-1",
        status: "complete",
        // issue #320: buildSubmissionWarnings reads startTime for the month-straddle check.
        startTime: new Date("2026-01-05T00:00:00Z"),
        biocharDryMassKg: 1000,
        samples: [],
        readingsCount: 0,
      } as never,
    ]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result.entityReadinessGaps).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Production run PR-1: Telemetry readings"),
      ]),
    );
  });

  it("flags missingDefaultTemplateId when the saved template is not in the list (drift)", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "rvt_stale" }),
    );
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([template("rvt_other")]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result.defaultTemplate).toBeNull();
    expect(result.missingDefaultTemplateId).toBe("rvt_stale");
    expect(result.blueprintsForTemplate).toEqual([]);
    expect(result.unresolvedBlueprintKeys).toEqual([]);
    expect(mockedListBlueprints).not.toHaveBeenCalled();
  });

  it("reports unresolvedBlueprintKeys when the catalog is missing keys referenced by the template", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "rvt_resolved" }),
    );
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([
      template("rvt_resolved", ["key_known", "key_unknown"]),
    ]);
    mockedListBlueprints.mockResolvedValue([blueprint("key_known")]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result.defaultTemplate?.id).toBe("rvt_resolved");
    expect(result.missingDefaultTemplateId).toBeNull();
    expect(result.blueprintsForTemplate.map((bp) => bp.key)).toEqual([
      "key_known",
    ]);
    expect(result.unresolvedBlueprintKeys).toEqual(["key_unknown"]);
  });

  it("returns the fully-resolved shape when project, template, and blueprints all resolve", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "rvt_resolved" }),
    );
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([
      template("rvt_resolved", ["key_a", "key_b"]),
    ]);
    mockedListBlueprints.mockResolvedValue([
      blueprint("key_a"),
      blueprint("key_b"),
      blueprint("key_unrelated"),
    ]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result.defaultTemplate?.id).toBe("rvt_resolved");
    expect(result.missingDefaultTemplateId).toBeNull();
    expect(result.unresolvedBlueprintKeys).toEqual([]);
    expect(result.blueprintsForTemplate.map((bp) => bp.key).sort()).toEqual([
      "key_a",
      "key_b",
    ]);
    expect(result.transportCoverage.feedstock.count).toBe(0);
    expect(result.productionReadinessGap).toMatchObject({
      kind: "noApplications",
      detail:
        "No applications fall in this batch's crediting period — record an application in the period, or adjust the period.",
      fixTarget: "applications",
    });
    expect(mockedGetLegs).not.toHaveBeenCalled();
    expect(result.linkedGhgStatement).toBeNull();
    expect(result.runSummary.runCount).toBe(0);
  });

  it("populates removal-level transportCoverage by walking the application lineage", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      facilityId: FACILITY_ID,
      productionRunIds: ["pr-1"],
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "rvt_resolved" }),
    );
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([template("rvt_resolved")]);
    mockedListBlueprints.mockResolvedValue([]);

    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: {
        applicationDate: new Date("2026-01-20T00:00:00Z"),
      } as never,
      delivery: {} as never,
      order: null,
      biocharProduct: { id: "bp-1" } as never,
      productionRun: { id: "pr-1" } as never,
      reactor: null,
      feedstocks: [{ id: "fs-1" } as never, { id: "fs-2" } as never],
      warnings: [],
    } as Awaited<ReturnType<typeof getChainOfCustodyData>>);
    mockedGetRuns.mockResolvedValue([
      {
        id: "pr-1",
        code: "PR-1",
        status: "complete",
        // issue #320: buildSubmissionWarnings reads startTime for the month-straddle check.
        startTime: new Date("2026-01-05T00:00:00Z"),
        feedstockWetMassKg: 100,
        feedstockMoisturePercent: 10,
        biocharOutputKg: 40,
        biocharMoisturePercent: 12,
        dieselOperationLiters: 0,
        preprocessingFuelLiters: 0,
        dieselGensetLiters: 0,
        electricityKwh: 0,
        samples: [],
        readingsCount: 1,
      } as never,
    ]);
    mockedGetBatchesWithSamples.mockResolvedValue([
      {
        creditBatchId: CREDIT_BATCH_ID,
        creditBatchCode: "CB-1",
        productionProcessId: null,
        sampling: "sampled",
        declaredHToCorgRatio: null,
        durabilityOption: "200_year",
        runs: [{ id: "pr-1", code: "PR-1", biocharDryMassKg: 35 }],
        samples: [{ id: "s-1" } as never, { id: "s-2" } as never],
      } as never,
    ]);

    mockedGetLegs.mockImplementation(async (_user, entityType) => {
      if (entityType === "feedstock") {
        return [{ id: "tl-f1" }, { id: "tl-f2" }, { id: "tl-f3" }] as never;
      }
      if (entityType === "sample") return [{ id: "tl-s1" }] as never;
      return [];
    });

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    const coverage = result.transportCoverage;
    expect(coverage.feedstock.count).toBe(3);
    expect(coverage.feedstock.entityIds.sort()).toEqual(["fs-1", "fs-2"]);
    expect(coverage.biochar.count).toBe(0);
    expect(coverage.biochar.entityIds).toEqual(["bp-1"]);
    expect(coverage.sample.count).toBe(1);
    expect(coverage.sample.entityIds.sort()).toEqual(["s-1", "s-2"]);
    expect(mockedGetLegs).toHaveBeenCalledTimes(3);
  });
});

function transportTemplate(
  id: string,
  omit: ReadonlyArray<"feedstock" | "biochar" | "sample"> = [],
): IsometricGhgEntryTemplate {
  const categories = [
    {
      key: "biomass-feedstock-transport",
      blueprint_key: "mass_distance_based_ci_emissions",
      input_key: "mass_distance",
      category: "feedstock" as const,
    },
    {
      key: "biochar-transport",
      blueprint_key: "mass_distance_based_ci_emissions",
      input_key: "mass_distance",
      category: "biochar" as const,
    },
    {
      key: "sampling-required-for-mrv",
      blueprint_key: "mass_distance_based_ci_emissions",
      input_key: "mass_distance",
      category: "sample" as const,
    },
  ].filter((c) => !omit.includes(c.category));

  return {
    id,
    name: `Template ${id}`,
    groups: categories.map((c, idx) => ({
      id: `${id}-grp-${idx}`,
      key: c.key,
      name: c.key,
      components: [
        {
          id: `${id}-comp-${idx}`,
          blueprint_key: c.blueprint_key,
          display_name: c.blueprint_key,
          inputs: [
            {
              type: "monitored",
              input_key: c.input_key,
              datapoint_id: null,
            },
          ],
        },
      ],
    })),
  } as unknown as IsometricGhgEntryTemplate;
}

describe("requiredTransportCategories", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockNormalizedLineageFacts();
    mockedHasCredentials.mockResolvedValue(true);
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      productionRunIds: [],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetApplicationsForRuns.mockImplementation(async (_userId, runIds) =>
      runIds.includes("pr-1") ? [APPLICATION_FOR_PR_1] : [],
    );
    mockedGetLegs.mockResolvedValue([]);
    mockedGetLineage.mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof getChainOfCustodyData>>,
    );
    mockedGetRuns.mockResolvedValue([]);
    mockedGetBatchesWithSamples.mockResolvedValue([]);
    mockedListDocuments.mockResolvedValue([]);
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListBlueprints.mockResolvedValue([]);
  });

  it("collects all three categories when the template requests all of them", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "tpl_full" }),
    );
    mockedListTemplates.mockResolvedValue([transportTemplate("tpl_full")]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );
    expect(result.requiredTransportCategories).toEqual([
      "feedstock",
      "biochar",
      "sample",
    ]);
  });

  it("returns a subset when the template omits a transport group", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "tpl_no_sample" }),
    );
    mockedListTemplates.mockResolvedValue([
      transportTemplate("tpl_no_sample", ["sample"]),
    ]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );
    expect(result.requiredTransportCategories).toEqual([
      "feedstock",
      "biochar",
    ]);
  });

  it("derives required transport categories from the template and surfaces coverage warnings without producing readiness gaps", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      productionRunIds: ["pr-1"],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "tpl_no_sample" }),
    );
    mockedListTemplates.mockResolvedValue([
      transportTemplate("tpl_no_sample", ["sample"]),
    ]);
    mockedListBlueprints.mockResolvedValue([
      blueprint("mass_distance_based_ci_emissions"),
    ]);
    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: {
        biocharAppliedDryTons: 0.1,
        applicationDate: new Date("2026-01-20T00:00:00Z"),
      } as never,
      delivery: {} as never,
      order: null,
      biocharProduct: { id: "bp-1" } as never,
      productionRun: { id: "pr-1" } as never,
      reactor: null,
      feedstocks: [{ id: "fs-1" } as never],
      warnings: [],
    } as Awaited<ReturnType<typeof getChainOfCustodyData>>);
    mockedGetRuns.mockResolvedValue([
      {
        id: "pr-1",
        code: "PR-1",
        status: "complete",
        // issue #320: buildSubmissionWarnings reads startTime for the month-straddle check.
        startTime: new Date("2026-01-05T00:00:00Z"),
        feedstockWetMassKg: 100,
        feedstockMoisturePercent: 10,
        biocharOutputKg: 40,
        biocharDryMassKg: 35,
        biocharMoisturePercent: 12,
        dieselOperationLiters: 0,
        preprocessingFuelLiters: 0,
        dieselGensetLiters: 0,
        electricityKwh: 0,
        readingsCount: 1,
        samples: [
          {
            id: "s-1",
            sampleCode: "S-1",
            organicCarbonPercent: 70,
            hToCOrgRatio: 0.4,
            durabilityOption: "200_year",
          },
        ],
      } as never,
    ]);
    mockedGetLegs.mockImplementation(async (_user, entityType) => {
      if (entityType === "sample") {
        return [{ id: "tl-s1", entityId: "s-1", distanceKm: 12 }] as never;
      }
      return [];
    });
    mockedListDocuments.mockResolvedValue(
      satisfiedVisualEvidenceDocuments("app-1"),
    );

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result.requiredTransportCategories).toEqual(["feedstock", "biochar"]);
    expect(result.entityReadinessGaps).toEqual([]);
    expect(result.transportCoverage.sample.aggregationWarning).toContain("tl-s1");
  });

  it("requires 1000-year sample data from the credit batch durability pathway", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      productionRunIds: ["pr-1"],
      durabilityOption: "1000_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "tpl_ready" }),
    );
    mockedListTemplates.mockResolvedValue([transportTemplate("tpl_ready", [])]);
    mockedListBlueprints.mockResolvedValue([]);
    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: {
        biocharAppliedDryTons: 0.1,
        applicationDate: new Date("2026-01-20T00:00:00Z"),
      } as never,
      delivery: {} as never,
      order: null,
      biocharProduct: null,
      productionRun: { id: "pr-1" } as never,
      reactor: null,
      feedstocks: [],
      warnings: [],
    } as Awaited<ReturnType<typeof getChainOfCustodyData>>);
    mockedGetRuns.mockResolvedValue([
      {
        id: "pr-1",
        code: "PR-1",
        status: "complete",
        // issue #320: buildSubmissionWarnings reads startTime for the month-straddle check.
        startTime: new Date("2026-01-05T00:00:00Z"),
        feedstockWetMassKg: 100,
        feedstockMoisturePercent: 10,
        biocharOutputKg: 40,
        biocharDryMassKg: 35,
        biocharMoisturePercent: 12,
        dieselOperationLiters: 0,
        preprocessingFuelLiters: 0,
        dieselGensetLiters: 0,
        electricityKwh: 0,
        readingsCount: 1,
        samples: [],
      } as never,
    ]);
    mockedGetBatchesWithSamples.mockResolvedValue([
      {
        creditBatchId: CREDIT_BATCH_ID,
        creditBatchCode: "CB-1",
        productionProcessId: null,
        sampling: "sampled",
        declaredHToCorgRatio: null,
        durabilityOption: "1000_year",
        runs: [{ id: "pr-1", code: "PR-1", biocharDryMassKg: 35 }],
        samples: [
          {
            id: "s-1",
            sampleCode: "S-1",
            organicCarbonPercent: 70,
            hToCOrgRatio: 0.4,
            randomReflectanceR0Percent: null,
            reactiveCarbonPercent: null,
            residualCarbonPercent: null,
          } as never,
        ],
      } as never,
    ]);
    mockedListDocuments.mockResolvedValue(
      satisfiedVisualEvidenceDocuments("app-1"),
    );

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );

    expect(result.entityReadinessGaps).toEqual([
      "Sample S-1: TGA non-reactive carbon data · R0 reflectance · R₀ readings at or above 2%",
    ]);
  });

  it("returns an empty list when the template has no transport inputs", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "tpl_none" }),
    );
    mockedListTemplates.mockResolvedValue([
      transportTemplate("tpl_none", ["feedstock", "biochar", "sample"]),
    ]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );
    expect(result.requiredTransportCategories).toEqual([]);
  });

  it("returns an empty list when there is no resolved template", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: null }),
    );
    mockedListTemplates.mockResolvedValue([]);

    const result = await loadCertifyContextForCreditBatchForUser(
      makeTestOrgContext(USER_ID),
      CREDIT_BATCH_ID,
    );
    expect(result.requiredTransportCategories).toEqual([]);
  });
});
