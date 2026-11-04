import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const rows = vi.hoisted(() => ({ bins: [] as { id: string; facilityId: string }[] }));
vi.mock("@/db", () => ({ db: { select: () => ({ from: () => ({ where: async () => rows.bins }) }) } }));
const lane = vi.hoisted(() => vi.fn());
vi.mock("./lane-stock-derivation", () => ({ deriveLaneStock: lane }));
vi.mock("./utils", () => ({ requireOrgScope: () => undefined }));

import { getFacilityFeedstockWetStock } from "./facility-feedstock-stock";

const ctx = { organizationId: "org", userId: "user", orgRole: "admin", isPlatformAdmin: false } as OrgContext;

function stage(wetKgs: number[]) {
  rows.bins = wetKgs.map((_, index) => ({ id: `b${index}`, facilityId: "f1" }));
  lane.mockResolvedValue(wetKgs.map((feedstockStockWetKg, index) => ({ storageLocationId: `b${index}`, feedstockStockWetKg })));
}

describe("facility feedstock stock", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves out bins that read Empty, as the feedstock lane total does", async () => {
    stage(Array.from({ length: 10 }, () => 0.04));
    expect((await getFacilityFeedstockWetStock(ctx, ["f1"])).get("f1") ?? 0).toBe(0);
  });

  it("sums the bins that show a figure and keeps a negative balance", async () => {
    stage([0.04, 12, 0.3, -2]);
    expect((await getFacilityFeedstockWetStock(ctx, ["f1"])).get("f1")).toBeCloseTo(10.3);
  });
});
