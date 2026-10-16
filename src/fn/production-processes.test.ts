import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), eligibility: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.context }));
vi.mock("@/data-access/production-processes", () => ({ getMethodBEligibility: mocks.eligibility }));

import { getMethodBEligibilityFn } from "./production-processes";

const ctx = { organizationId: "org-preview" };
const pair = {
  facilityId: "00000000-0000-4000-8000-000000000001",
  feedstockTypeId: "00000000-0000-4000-8000-000000000002",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(ctx);
  mocks.eligibility.mockResolvedValue({ productionProcessId: "historical" });
});

describe("getMethodBEligibilityFn", () => {
  it.each(["2025-06-02", new Date("2025-06-01T23:30:00-02:00")])("passes the normalized UTC calendar day for %s", async (asOfDate) => {
    expect(await getMethodBEligibilityFn({ ...pair, asOfDate })).toMatchObject({ success: true });
    expect(mocks.eligibility).toHaveBeenCalledWith(ctx, { ...pair, asOfDate: new Date("2025-06-02T00:00:00Z") });
  });

  it("keeps current-time resolution when no date is supplied", async () => {
    expect(await getMethodBEligibilityFn(pair)).toMatchObject({ success: true });
    expect(mocks.eligibility).toHaveBeenCalledWith(ctx, pair);
  });

  it("rejects an invalid date before querying eligibility", async () => {
    expect(await getMethodBEligibilityFn({ ...pair, asOfDate: "invalid" })).toMatchObject({
      success: false, code: "validation_failed", issues: [{ path: ["asOfDate"] }],
    });
    expect(mocks.eligibility).not.toHaveBeenCalled();
  });
});
