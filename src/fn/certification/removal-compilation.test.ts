import { reviewedTemplateSources } from "../../../tests/helpers/template-line-sources";
import { unsupportedTemplate } from "../../../tests/fixtures/isometric/unsupported-template";
import { findUnbindableTemplateInputs as findCoverage, formatUnbindableTemplateInputsText } from "@/lib/isometric/template-binding-coverage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const ORG_CTX = vi.hoisted((): OrgContext => ({
  userId: "user-test-1",
  organizationId: "org-test-1",
  orgRole: "owner",
  isPlatformAdmin: false,
}));

vi.mock("../with-action", async () => {
  const { mockWithAction } = await import("../../../tests/helpers/mock-with-action");
  return mockWithAction(ORG_CTX);
});
vi.mock("@/data-access/utils", () => ({
  requireOrgFacility: vi.fn(),
}));
vi.mock("@/data-access/certifier-removals", () => ({
  getCertifierRemovalById: vi.fn(),
}));
vi.mock("./certify-context-core", () => ({
  loadRemovalSubmissionContext: vi.fn(),
}));
vi.mock("./removal-submission-build", async (importOriginal) => ({
  ...await importOriginal<typeof import("./removal-submission-build")>(),
  compileRemovalSubmission: vi.fn(),
  buildRemovalSubmissionBuild: vi.fn(),
}));
vi.mock("@/data-access/credit-batch-accounting", () => ({
  getCo2eStoredPreviews: vi.fn(),
}));
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { getCo2eStoredPreviews } from "@/data-access/credit-batch-accounting";
import { compileRemovalSubmission, buildRemovalSubmissionBuild, REMOVAL_COMPILATION_FAILED_MESSAGE } from "./removal-submission-build";
import { REMOVAL_PREPARATION_BLOCKERS } from "./removal-submission-prepare";
import { requireOrgFacility } from "@/data-access/utils";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import { logger } from "@/lib/log";
import { SafeError } from "@/lib/errors";
import { loadRemovalCompilation } from "./removal-compilation";

describe("loadRemovalCompilation facility scope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("refuses a Removal UUID owned by another selected facility before loading compilation context", async () => {
    vi.mocked(getCertifierRemovalById).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      facilityId: "00000000-0000-4000-8000-0000000000aa",
    } as never);

    const result = await loadRemovalCompilation(
      "00000000-0000-4000-8000-0000000000bb",
      "00000000-0000-4000-8000-000000000001",
    );

    expect(requireOrgFacility).toHaveBeenCalledWith(
      ORG_CTX,
      "00000000-0000-4000-8000-0000000000bb",
    );
    expect(result).toEqual({
      success: false,
      error: "Removal does not belong to requested facility",
    });
    expect(loadRemovalSubmissionContext).not.toHaveBeenCalled();
  });
});

describe("loadRemovalCompilation preparation blockers", () => {
  const FACILITY_ID = "00000000-0000-4000-8000-0000000000aa";
  const REMOVAL_ID = "00000000-0000-4000-8000-000000000001";
  const template = {
    id: "rvt-1",
    display_name: "Removal template",
    credit_type: "REMOVAL",
    groups: [{ components: [{ id: "cmp-1", blueprint_key: "electricity_grid", inputs: [] }] }],
  };
  const baseContext = {
    mapping: { externalProjectId: "prj-1" },
    hasOrgCredentials: true,
    templateBlockers: [],
    lineSources: reviewedTemplateSources(template as unknown as Parameters<typeof reviewedTemplateSources>[0]),
    removalTemplate: template,
    unbindableTemplateInputs: [],
    unresolvedBlueprintKeys: [],
    blueprintsForTemplate: [],
    memberBatches: [{ id: "batch" }],
    batchesWithSamples: [{ sampling: "sampled", durabilityOption: "1000_year" }],
    feedstockTypeMappingGaps: [],
    entityReadinessGaps: [],
    submissionWarnings: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getCertifierRemovalById).mockResolvedValue({
      id: REMOVAL_ID,
      facilityId: FACILITY_ID,
    } as never);
    vi.mocked(getCo2eStoredPreviews).mockResolvedValue({});
    vi.mocked(compileRemovalSubmission).mockResolvedValue({
      review: { template: { id: "rvt-1" } },
      blockers: ["Add the application logbook."],
      warnings: [],
      snapshot: null,
      transportPlan: null,
    } as never);
  });

  it("reports feedstock mapping and durability configuration through the shared gate", async () => {
    const { make1000YearSequestrationTemplate } = await import("../../../tests/fixtures/submit-removal-templates");
    const removalTemplate = make1000YearSequestrationTemplate();
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue({
      ...baseContext, removalTemplate, lineSources: reviewedTemplateSources(removalTemplate),
      feedstockTypeMappingGaps: [{ creditBatchId: "batch", creditBatchCode: "CB-1", feedstockTypeId: "type", feedstockTypeName: "Wood" }],
      batchesWithSamples: [{ sampling: "unsampled", durabilityOption: "1000_year" }],
    } as never);
    const result = await loadRemovalCompilation(FACILITY_ID, REMOVAL_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.removalBlockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining(["feedstockTypeMapping", "durabilityConfiguration"]));
    expect(result.data.blockers).toEqual(result.data.removalBlockers.map((blocker) => blocker.message));
    expect(result.data.snapshot).toBeNull();
  });

  it("keeps review available with one generic blocker after an unexpected preflight build failure", async () => {
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue(baseContext as never);
    vi.mocked(buildRemovalSubmissionBuild).mockRejectedValue(new Error("private source detail"));
    // Even a rich compile with a snapshot cannot override the preflight refusal.
    vi.mocked(compileRemovalSubmission).mockResolvedValue({ review: { template: { id: "rvt-1" } }, blockers: [], warnings: [], snapshot: { semanticPayload: {} } } as never);
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      expect(await loadRemovalCompilation(FACILITY_ID, REMOVAL_ID)).toMatchObject({
        success: true,
        data: {
          blockers: [REMOVAL_COMPILATION_FAILED_MESSAGE],
          removalBlockers: [{ code: "legacy", message: REMOVAL_COMPILATION_FAILED_MESSAGE, fixTarget: null }],
          snapshot: null, compilationHash: null,
        },
      });
      expect(log).toHaveBeenCalledExactlyOnceWith({ organizationId: ORG_CTX.organizationId, removalId: REMOVAL_ID }, "removal preflight build failed");
    } finally { log.mockRestore(); }
  });

  it("lists a rich compilation blocker found after a clear preflight", async () => {
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue(baseContext as never);
    const result = await loadRemovalCompilation(FACILITY_ID, REMOVAL_ID);
    expect(result).toMatchObject({
      success: true,
      data: {
        blockers: ["Add the application logbook."],
        removalBlockers: [{ code: "legacy", message: "Add the application logbook.", fixTarget: null }],
        snapshot: null,
        compilationHash: null,
      },
    });
  });

  it("lists missing credentials as a blocker instead of failing the review", async () => {
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue({
      ...baseContext,
      hasOrgCredentials: false,
      removalTemplate: null,
    } as never);

    const result = await loadRemovalCompilation(FACILITY_ID, REMOVAL_ID);

    expect(result).toMatchObject({
      success: true,
      data: {
        review: null,
        blockers: [REMOVAL_PREPARATION_BLOCKERS.noCredentials],
        compilationHash: null,
      },
    });
    expect(compileRemovalSubmission).not.toHaveBeenCalled();
    expect(loadRemovalSubmissionContext).toHaveBeenCalledWith(expect.anything(), REMOVAL_ID, { refreshEnrichment: true });
  });

  it("lists a shared preflight build and rich compilation refusal only once", async () => {
    const message = "Removal submission blocked:\nProduction run PR-1 has no dry mass.";
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue(baseContext as never);
    vi.mocked(buildRemovalSubmissionBuild).mockRejectedValue(new SafeError(message));
    vi.mocked(compileRemovalSubmission).mockResolvedValue({
      review: { template: { id: "rvt-1" } },
      blockers: [message],
      warnings: [],
      snapshot: { semanticPayload: {} },
    } as never);

    expect(await loadRemovalCompilation(FACILITY_ID, REMOVAL_ID)).toMatchObject({
      success: true,
      data: {
        blockers: [message],
        removalBlockers: [{ code: "legacy", message, fixTarget: null }],
        snapshot: null,
        compilationHash: null,
      },
    });
  });

  it("deduplicates template blockers from preparation and compilation", async () => {
    const removalTemplate = unsupportedTemplate();
    const message = formatUnbindableTemplateInputsText(findUnbindableTemplateInputs(removalTemplate));
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue({ ...baseContext, removalTemplate, lineSources: reviewedTemplateSources(removalTemplate) } as never);
    vi.mocked(compileRemovalSubmission).mockResolvedValue({ review: { template: { id: removalTemplate.id } }, blockers: [message], warnings: [], snapshot: null, transportPlan: null } as never);
    const result = await loadRemovalCompilation(FACILITY_ID, REMOVAL_ID);
    expect(result.success && result.data.blockers.filter((blocker) => blocker === message)).toEqual([message]);
  });

  it("still compiles a resolved template and lists its gates first", async () => {
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue({
      ...baseContext,
      removalTemplate: { ...template, credit_type: "REDUCTION" },
    } as never);

    const result = await loadRemovalCompilation(FACILITY_ID, REMOVAL_ID);

    expect(result).toMatchObject({
      success: true,
      data: {
        review: { template: { id: "rvt-1" } },
        blockers: [
          REMOVAL_PREPARATION_BLOCKERS.notRemovalTemplate,
          "Add the application logbook.",
        ],
        removalBlockers: [
          { code: "notRemovalTemplate", message: REMOVAL_PREPARATION_BLOCKERS.notRemovalTemplate, fixTarget: "creditBatchTemplate" },
          { code: "legacy", message: "Add the application logbook.", fixTarget: null },
        ],
        snapshot: null,
        compilationHash: null,
      },
    });
  });
});

function findUnbindableTemplateInputs(template: Parameters<typeof findCoverage>[0], options: Parameters<typeof findCoverage>[1] = {}) {
  return findCoverage(template, { lineSources: reviewedTemplateSources(template as unknown as Parameters<typeof reviewedTemplateSources>[0]), ...options });
}
