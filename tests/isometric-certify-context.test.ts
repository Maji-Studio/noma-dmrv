import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCertifierProjectByFacility,
  type CertifierProjectRow,
} from "@/data-access/certification";
import { getChainOfCustodyData } from "@/data-access/chain-of-custody";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getDeliveriesByIds } from "@/data-access/deliveries";
import { getFeedstocksByIds } from "@/data-access/feedstocks";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import {
  listComponentBlueprints,
  listProjects,
  listGhgEntryTemplates,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { loadCertifyContextForCreditBatchForUser } from "@/fn/certification/certify-context-core";

vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchById: vi.fn(),
}));

vi.mock("@/data-access/certification", () => ({
  getCertifierProjectByFacility: vi.fn(),
}));

vi.mock("@/data-access/chain-of-custody", () => ({
  getChainOfCustodyData: vi.fn(),
}));

vi.mock("@/data-access/production-runs", () => ({
  getProductionRunsWithSamples: vi.fn(),
}));

vi.mock("@/data-access/feedstocks", () => ({
  getFeedstocksByIds: vi.fn(),
}));

vi.mock("@/data-access/deliveries", () => ({
  getDeliveriesByIds: vi.fn(),
}));

vi.mock("@/data-access/transport-legs", () => ({
  getTransportLegsForEntities: vi.fn(),
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
const mockedGetMapping = vi.mocked(getCertifierProjectByFacility);
const mockedGetLineage = vi.mocked(getChainOfCustodyData);
const mockedGetRuns = vi.mocked(getProductionRunsWithSamples);
const mockedGetFeedstocksByIds = vi.mocked(getFeedstocksByIds);
const mockedGetDeliveriesByIds = vi.mocked(getDeliveriesByIds);
const mockedGetLegs = vi.mocked(getTransportLegsForEntities);
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
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      applicationIds: [],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    // Default the transport-coverage walkers to empty so each test only
    // overrides what it cares about.
    mockedGetLineage.mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof getChainOfCustodyData>>,
    );
    mockedGetRuns.mockResolvedValue([]);
    mockedGetFeedstocksByIds.mockResolvedValue([]);
    mockedGetDeliveriesByIds.mockResolvedValue([]);
    mockedGetLegs.mockResolvedValue([]);
  });

  it("returns the unlinked shape and skips remote calls when no certifier mapping exists", async () => {
    mockedGetMapping.mockResolvedValue(null);

    const result = await loadCertifyContextForCreditBatchForUser(
      USER_ID,
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

  it("returns linked-no-default shape when defaultRemovalTemplateId is null", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: null }),
    );
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([template("rvt_1")]);

    const result = await loadCertifyContextForCreditBatchForUser(
      USER_ID,
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
      applicationIds: ["app-1"],
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
        biocharDryMassKg: 1000,
        samples: [],
      } as never,
    ]);

    const result = await loadCertifyContextForCreditBatchForUser(
      USER_ID,
      CREDIT_BATCH_ID,
    );

    expect(result.defaultTemplate).toBeNull();
    expect(result.hasSubmittableRuns).toBe(true);
    expect(result.productionReadinessGap).toBeNull();
    expect(result.runSummary.runCount).toBe(1);
    expect(mockedGetLineage).toHaveBeenCalledWith(USER_ID, "app-1");
  });

  it("flags resolved production runs that have no telemetry readings", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      applicationIds: ["app-1"],
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
        biocharDryMassKg: 1000,
        samples: [],
        readingsCount: 0,
      } as never,
    ]);

    const result = await loadCertifyContextForCreditBatchForUser(
      USER_ID,
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
      USER_ID,
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
      USER_ID,
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
      USER_ID,
      CREDIT_BATCH_ID,
    );

    expect(result.defaultTemplate?.id).toBe("rvt_resolved");
    expect(result.missingDefaultTemplateId).toBeNull();
    expect(result.unresolvedBlueprintKeys).toEqual([]);
    expect(result.blueprintsForTemplate.map((bp) => bp.key).sort()).toEqual([
      "key_a",
      "key_b",
    ]);
    // No applications on the stub batch -> transport coverage is empty.
    expect(result.transportCoverage.feedstock.count).toBe(0);
    expect(result.productionReadinessGap).toMatchObject({
      kind: "noApplications",
      detail: "No applications linked to this batch",
      fixTarget: "batchDetails",
    });
    expect(mockedGetLegs).not.toHaveBeenCalled();
    // An ungrouped batch (no removal) has no linked GHG Statement and an empty
    // run summary — the up-front loads short-circuit to null/zero.
    expect(result.linkedGhgStatement).toBeNull();
    expect(result.runSummary.runCount).toBe(0);
  });

  it("populates removal-level transportCoverage by walking the application lineage", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      facilityId: FACILITY_ID,
      applicationIds: ["app-1"],
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "rvt_resolved" }),
    );
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListTemplates.mockResolvedValue([template("rvt_resolved")]);
    mockedListBlueprints.mockResolvedValue([]);

    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: {} as never,
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
        samples: [{ id: "s-1" } as never, { id: "s-2" } as never],
      } as never,
    ]);

    // Per-category leg counts: 3 feedstock, 0 biochar, 1 sample.
    mockedGetLegs.mockImplementation(async (_user, entityType) => {
      if (entityType === "feedstock") {
        return [{ id: "tl-f1" }, { id: "tl-f2" }, { id: "tl-f3" }] as never;
      }
      if (entityType === "sample") return [{ id: "tl-s1" }] as never;
      return [];
    });

    const result = await loadCertifyContextForCreditBatchForUser(
      USER_ID,
      CREDIT_BATCH_ID,
    );

    const coverage = result.transportCoverage;
    expect(coverage.feedstock.count).toBe(3);
    expect(coverage.feedstock.entityIds.sort()).toEqual(["fs-1", "fs-2"]);
    expect(coverage.biochar.count).toBe(0);
    expect(coverage.biochar.entityIds).toEqual(["bp-1"]);
    expect(coverage.sample.count).toBe(1);
    expect(coverage.sample.entityIds.sort()).toEqual(["s-1", "s-2"]);
    // Three transport categories, one pooled load each.
    expect(mockedGetLegs).toHaveBeenCalledTimes(3);
  });
});

// ============================================================
// requiredTransportCategories derivation
// ============================================================

// Builds a template whose first group bundles three components, each with a
// single monitored `distance` input — matching the three transport rows in
// INPUT_MAPPING. The optional `omit` list lets a test simulate a template
// that doesn't request a particular category.
function transportTemplate(
  id: string,
  omit: ReadonlyArray<"feedstock" | "biochar" | "sample"> = [],
): IsometricGhgEntryTemplate {
  const categories = [
    {
      key: "biomass-feedstock-transport",
      blueprint_key: "transport",
      input_key: "distance",
      category: "feedstock" as const,
    },
    {
      key: "biochar-transport",
      blueprint_key: "transport",
      input_key: "distance",
      category: "biochar" as const,
    },
    {
      key: "sampling-required-for-mrv",
      blueprint_key: "distance_based_ci_emissions",
      input_key: "distance",
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
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      applicationIds: [],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetLegs.mockResolvedValue([]);
    mockedGetLineage.mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof getChainOfCustodyData>>,
    );
    mockedGetRuns.mockResolvedValue([]);
    mockedListProjects.mockResolvedValue([project(EXTERNAL_PROJECT_ID)]);
    mockedListBlueprints.mockResolvedValue([]);
  });

  it("collects all three categories when the template requests all of them", async () => {
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "tpl_full" }),
    );
    mockedListTemplates.mockResolvedValue([transportTemplate("tpl_full")]);

    const result = await loadCertifyContextForCreditBatchForUser(
      USER_ID,
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
      USER_ID,
      CREDIT_BATCH_ID,
    );
    expect(result.requiredTransportCategories).toEqual([
      "feedstock",
      "biochar",
    ]);
  });

  it("only reports transport readiness gaps for categories required by the template", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      applicationIds: ["app-1"],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "tpl_no_sample" }),
    );
    mockedListTemplates.mockResolvedValue([
      transportTemplate("tpl_no_sample", ["sample"]),
    ]);
    mockedListBlueprints.mockResolvedValue([blueprint("transport")]);
    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: { biocharAppliedDryTons: 0.1 } as never,
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
        feedstockWetMassKg: 100,
        feedstockMoisturePercent: 10,
        biocharOutputKg: 40,
        biocharDryMassKg: 35,
        biocharMoisturePercent: 12,
        dieselOperationLiters: 0,
        preprocessingFuelLiters: 0,
        dieselGensetLiters: 0,
        electricityKwh: 0,
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

    const result = await loadCertifyContextForCreditBatchForUser(
      USER_ID,
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
      applicationIds: ["app-1"],
      durabilityOption: "1000_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "tpl_ready" }),
    );
    mockedListTemplates.mockResolvedValue([transportTemplate("tpl_ready", [])]);
    mockedListBlueprints.mockResolvedValue([]);
    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: { biocharAppliedDryTons: 0.1 } as never,
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
        feedstockWetMassKg: 100,
        feedstockMoisturePercent: 10,
        biocharOutputKg: 40,
        biocharDryMassKg: 35,
        biocharMoisturePercent: 12,
        dieselOperationLiters: 0,
        preprocessingFuelLiters: 0,
        dieselGensetLiters: 0,
        electricityKwh: 0,
        samples: [
          {
            id: "s-1",
            sampleCode: "S-1",
            organicCarbonPercent: 70,
            hToCOrgRatio: 0.4,
            randomReflectanceR0Percent: null,
            reactiveCarbonPercent: null,
            residualCarbonPercent: null,
          },
        ],
      } as never,
    ]);

    const result = await loadCertifyContextForCreditBatchForUser(
      USER_ID,
      CREDIT_BATCH_ID,
    );

    expect(result.entityReadinessGaps).toEqual([
      "Sample S-1: TGA non-reactive carbon data · R0 reflectance",
    ]);
  });

  it("surfaces missing truck weighing for feedstock intake and delivery lineage", async () => {
    mockedGetCreditBatch.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-1",
      facilityId: FACILITY_ID,
      applicationIds: ["app-1"],
      durabilityOption: "200_year",
    } as unknown as Awaited<ReturnType<typeof getCreditBatchById>>);
    mockedGetMapping.mockResolvedValue(
      mapping({ defaultRemovalTemplateId: "tpl_ready" }),
    );
    mockedListTemplates.mockResolvedValue([transportTemplate("tpl_ready", [])]);
    mockedListBlueprints.mockResolvedValue([]);
    mockedGetLineage.mockResolvedValue({
      facility: { id: FACILITY_ID, code: "F", name: "F" },
      application: { biocharAppliedDryTons: 0.1 } as never,
      delivery: { id: "del-1", code: "D-1" } as never,
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
        feedstockWetMassKg: 100,
        feedstockMoisturePercent: 10,
        biocharOutputKg: 40,
        biocharDryMassKg: 35,
        biocharMoisturePercent: 12,
        dieselOperationLiters: 0,
        preprocessingFuelLiters: 0,
        dieselGensetLiters: 0,
        electricityKwh: 0,
        samples: [
          {
            id: "s-1",
            sampleCode: "S-1",
            organicCarbonPercent: 70,
            hToCOrgRatio: 0.4,
          },
        ],
      } as never,
    ]);
    mockedGetFeedstocksByIds.mockResolvedValue([
      {
        id: "fs-1",
        code: "FS-1",
        truckMassOnArrivalKg: null,
        truckMassOnDepartureKg: 12_500,
      },
    ]);
    mockedGetDeliveriesByIds.mockResolvedValue([
      {
        id: "del-1",
        code: "D-1",
        truckMassOnArrivalKg: 8_000,
        truckMassOnDepartureKg: null,
      },
    ]);

    const result = await loadCertifyContextForCreditBatchForUser(
      USER_ID,
      CREDIT_BATCH_ID,
    );

    expect(result.entityReadinessGaps).toEqual([
      "Feedstock FS-1: truck weighing",
      "Delivery D-1: truck weighing",
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
      USER_ID,
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
      USER_ID,
      CREDIT_BATCH_ID,
    );
    expect(result.requiredTransportCategories).toEqual([]);
  });
});
