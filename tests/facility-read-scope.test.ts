import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getDashboardOverview: vi.fn(),
  limit: vi.fn(),
  requireOrgContext: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { select: mocks.select },
}));

vi.mock("@/data-access/dashboard-overview", () => ({
  getDashboardOverview: mocks.getDashboardOverview,
}));

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: mocks.requireOrgContext,
}));

import { getDashboardOverviewFn } from "@/fn/dashboard-overview";

const ACTIVE_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const FOREIGN_FACILITY_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";

describe("facility-scoped read guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgContext.mockResolvedValue({
      userId: USER_ID,
      organizationId: ACTIVE_ORGANIZATION_ID,
      orgRole: "admin",
      isPlatformAdmin: false,
    });
    mocks.limit.mockResolvedValue([]);
    mocks.where.mockReturnValue({ limit: mocks.limit });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.select.mockReturnValue({ from: mocks.from });
  });

  it("returns the standard error instead of querying dashboard data for a foreign facility", async () => {
    const result = await getDashboardOverviewFn({
      facilityId: FOREIGN_FACILITY_ID,
      range: "month",
    });

    expect(result).toEqual({
      success: false,
      error:
        "Facility was not found in this Organization. Refresh the page and try again.",
    });
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.getDashboardOverview).not.toHaveBeenCalled();
  });
});
