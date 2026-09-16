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
import { readProductionRuns } from "./production-runs";

const ACTIVE_CONTEXT = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "member" as const,
  isPlatformAdmin: false,
};
const FOREIGN_FACILITY_ID = "11111111-1111-4111-8111-111111111111";

describe("Production Run read model", () => {
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

  // JSON has no Date, so a client can send null where a Date filter belongs.
  // Coercing that to the epoch would silently apply a 1970 boundary.
  it("rejects a null date boundary instead of coercing it to the epoch", async () => {
    await expect(
      readProductionRuns(ACTIVE_CONTEXT, { startDate: null }),
    ).rejects.toThrow();

    expect(mocks.getProductionRuns).not.toHaveBeenCalled();
  });

  it("rejects a date filter that is not an ISO timestamp", async () => {
    await expect(
      readProductionRuns(ACTIVE_CONTEXT, { startDate: "2026-09-15" }),
    ).rejects.toThrow("Enter a valid date.");

    expect(mocks.getProductionRuns).not.toHaveBeenCalled();
  });

  it("accepts an ISO date boundary from the JSON transport", async () => {
    mocks.getProductionRuns.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });

    await readProductionRuns(ACTIVE_CONTEXT, {
      startDate: "2026-09-15T00:00:00.000Z",
    });

    expect(mocks.getProductionRuns).toHaveBeenCalledWith(
      ACTIVE_CONTEXT,
      expect.objectContaining({
        startDate: new Date("2026-09-15T00:00:00.000Z"),
      }),
    );
  });
});
