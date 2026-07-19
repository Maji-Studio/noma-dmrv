import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const mockSelect = vi.hoisted(() => vi.fn());

vi.mock("@/db", () => ({
  db: { select: mockSelect },
}));

import { getSampleStats } from "@/data-access/samples";

const ORG_CONTEXT: OrgContext = {
  userId: "user-sample-stats",
  organizationId: "org-sample-stats",
  orgRole: "owner",
  isPlatformAdmin: false,
};

function queueSelectResult(result: unknown[]) {
  mockSelect.mockImplementationOnce(() => {
    const query = {
      leftJoin: vi.fn(),
      where: vi.fn().mockResolvedValue(result),
    };
    query.leftJoin.mockReturnValue(query);
    return { from: vi.fn(() => query) };
  });
}

describe("getSampleStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves exact-zero numeric averages", async () => {
    queueSelectResult([
      {
        totalSamples: 2,
        avgCarbonPercent: 0,
        avgOrganicCarbonPercent: 0,
      },
    ]);
    queueSelectResult([{ count: 0 }]);

    const stats = await getSampleStats(ORG_CONTEXT);

    expect(stats.avgCarbonPercent).toBe(0);
    expect(stats.avgOrganicCarbonPercent).toBe(0);
  });

  it("preserves null averages when SQL AVG returns null", async () => {
    queueSelectResult([
      {
        totalSamples: 0,
        avgCarbonPercent: null,
        avgOrganicCarbonPercent: null,
      },
    ]);
    queueSelectResult([{ count: 0 }]);

    const stats = await getSampleStats(ORG_CONTEXT);

    expect(stats.avgCarbonPercent).toBeNull();
    expect(stats.avgOrganicCarbonPercent).toBeNull();
  });
});
