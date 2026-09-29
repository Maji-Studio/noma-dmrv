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
vi.mock("./removal-submission-build", () => ({
  compileRemovalSubmission: vi.fn(),
}));
vi.mock("@/data-access/credit-batch-accounting", () => ({
  getCo2eStoredPreviews: vi.fn(),
}));
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { getCo2eStoredPreviews } from "@/data-access/credit-batch-accounting";
import { compileRemovalSubmission } from "./removal-submission-build";
import { REMOVAL_PREPARATION_BLOCKERS } from "./removal-submission-prepare";
import { requireOrgFacility } from "@/data-access/utils";
import { loadRemovalSubmissionContext } from "./certify-context-core";
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
    groups: [{ components: [{ id: "cmp-1", blueprint_key: "electricity_grid" }] }],
  };
  const baseContext = {
    mapping: { externalProjectId: "prj-1" },
    hasOrgCredentials: true,
    missingDefaultTemplateId: null,
    defaultTemplate: template,
    unresolvedBlueprintKeys: [],
    blueprintsForTemplate: [],
    memberBatches: [],
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

  it("lists missing credentials as a blocker instead of failing the review", async () => {
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue({
      ...baseContext,
      hasOrgCredentials: false,
      defaultTemplate: null,
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
  });

  it("still compiles a resolved template and lists its gates first", async () => {
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue({
      ...baseContext,
      defaultTemplate: { ...template, credit_type: "REDUCTION" },
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
        snapshot: null,
        compilationHash: null,
      },
    });
  });
});
