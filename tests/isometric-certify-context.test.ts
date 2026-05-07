import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCertifierProjectByFacility,
  type CertifierProjectRow,
} from "@/data-access/certification";
import { getCreditBatchById } from "@/data-access/credit-batches";
import {
  listComponentBlueprints,
  listProjects,
  listRemovalTemplates,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricRemovalTemplate,
} from "@/lib/isometric";
import { loadCertifyContextForCreditBatchForUser } from "@/fn/certification/certify-context";

vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchById: vi.fn(),
}));

vi.mock("@/data-access/certification", () => ({
  getCertifierProjectByFacility: vi.fn(),
}));

vi.mock("@/lib/isometric", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/isometric")>("@/lib/isometric");
  return {
    ...actual,
    listProjects: vi.fn(),
    listRemovalTemplates: vi.fn(),
    listComponentBlueprints: vi.fn(),
  };
});

const mockedGetCreditBatch = vi.mocked(getCreditBatchById);
const mockedGetMapping = vi.mocked(getCertifierProjectByFacility);
const mockedListProjects = vi.mocked(listProjects);
const mockedListTemplates = vi.mocked(listRemovalTemplates);
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
): IsometricRemovalTemplate {
  return {
    id,
    name: `Template ${id}`,
    groups: [
      {
        id: `${id}-group-1`,
        name: "Group",
        components: blueprintKeys.map((key, idx) => ({
          id: `${id}-comp-${idx}`,
          blueprint_key: key,
        })),
      },
    ],
  } as unknown as IsometricRemovalTemplate;
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
      facilityId: FACILITY_ID,
    } as Awaited<ReturnType<typeof getCreditBatchById>>);
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
  });
});
