import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getDashboardOverview: vi.fn(),
  limit: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { select: mocks.select },
}));

vi.mock("@/data-access/dashboard-overview", () => ({
  getDashboardOverview: mocks.getDashboardOverview,
}));

import type { OrgContext } from "@/lib/auth/server";
import { readDashboardOverview } from "@/lib/read-models/dashboard-overview";

const ACTIVE_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const FOREIGN_FACILITY_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";

// The read core takes a verified context from its caller, so the test supplies
// one directly; authentication is the HTTP adapter's concern, not this guard's.
const CTX: OrgContext = {
  userId: USER_ID,
  organizationId: ACTIVE_ORGANIZATION_ID,
  orgRole: "admin",
  isPlatformAdmin: false,
};

describe("facility-scoped read guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue([]);
    mocks.where.mockReturnValue({ limit: mocks.limit });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.select.mockReturnValue({ from: mocks.from });
  });

  it("throws the standard error instead of querying dashboard data for a foreign facility", async () => {
    const result = readDashboardOverview(CTX, {
      facilityId: FOREIGN_FACILITY_ID,
      range: "month",
    });

    await expect(result).rejects.toThrow(
      "Facility was not found in this Organization.",
    );
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.getDashboardOverview).not.toHaveBeenCalled();
  });
});
