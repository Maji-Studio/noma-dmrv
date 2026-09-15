import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProductionRuns: vi.fn(),
  requireOrgFacility: vi.fn(),
}));

vi.mock("@/data-access/production-runs", () => ({
  getProductionRuns: mocks.getProductionRuns,
}));
vi.mock("@/data-access/utils", () => ({
  requireOrgFacility: mocks.requireOrgFacility,
}));

import { SafeError } from "@/lib/errors";
import { readProductionRuns } from "@/fn/read-models/production-runs";

const ACTIVE_CONTEXT = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "member" as const,
  isPlatformAdmin: false,
};
const FOREIGN_FACILITY_ID = "11111111-1111-4111-8111-111111111111";

describe("read-model facility isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a foreign facility before loading Production Runs", async () => {
    mocks.requireOrgFacility.mockRejectedValue(
      new SafeError("Facility not found in this organization"),
    );

    await expect(
      readProductionRuns(ACTIVE_CONTEXT, {
        facilityId: FOREIGN_FACILITY_ID,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow("Facility was not found in this Organization.");

    expect(mocks.requireOrgFacility).toHaveBeenCalledWith(
      ACTIVE_CONTEXT,
      FOREIGN_FACILITY_ID,
    );
    expect(mocks.getProductionRuns).not.toHaveBeenCalled();
  });
});
