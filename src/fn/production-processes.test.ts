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
  it.each(["2025-06-02", new Date("2025-06-02T00:00:00Z")])("passes the batch start day for %s", async (batchStartDate) => {
    expect(await getMethodBEligibilityFn({ ...pair, batchStartDate })).toMatchObject({ success: true });
    expect(mocks.eligibility).toHaveBeenCalledWith(ctx, { ...pair, batchStartDate: new Date("2025-06-02T00:00:00Z") });
  });

  it("keeps current-day resolution when no date is supplied", async () => {
    expect(await getMethodBEligibilityFn(pair)).toMatchObject({ success: true });
    expect(mocks.eligibility).toHaveBeenCalledWith(ctx, pair);
  });

  it.each([
    "invalid", "2025-02-30", "2025-06-01T23:30:00-02:00",
    new Date("2025-06-01T23:30:00-02:00"), null, 0,
  ])("rejects a non-calendar batch start value %s before querying eligibility", async (batchStartDate) => {
    expect(await getMethodBEligibilityFn({ ...pair, batchStartDate })).toMatchObject({
      success: false, code: "validation_failed", issues: [{ path: ["batchStartDate"] }],
    });
    expect(mocks.eligibility).not.toHaveBeenCalled();
  });
});
