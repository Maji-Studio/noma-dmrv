import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const ORG_CTX = {
  userId: "user-test-1",
  organizationId: "org-test-1",
  orgRole: "owner",
  isPlatformAdmin: false,
} as OrgContext;

vi.mock("../with-action", () => ({
  withAction: async <T>(fn: (ctx: OrgContext) => Promise<T>) => {
    try {
      return { success: true as const, data: await fn(ORG_CTX) };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Unexpected error",
      };
    }
  },
}));
vi.mock("@/data-access/utils", () => ({
  requireOrgFacility: vi.fn(),
}));
vi.mock("@/data-access/certifier-removals", () => ({
  getCertifierRemovalById: vi.fn(),
}));
vi.mock("./certify-context-core", () => ({
  loadRemovalSubmissionContext: vi.fn(),
}));

import { getCertifierRemovalById } from "@/data-access/certifier-removals";
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
