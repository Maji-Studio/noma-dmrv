import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

// A plain function, not vi.fn: vitest reports a rejecting spy as an unhandled error even when the caller catches it.
const mocks = vi.hoisted(() => ({
  loadDrafts: async (): Promise<unknown[]> => [],
}));

vi.mock("@/data-access/dashboard-overview", () => ({
  getDashboardOverview: async () => ({ attention: [{ id: "a1" }], attentionTotal: 1 }),
}));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: async () => undefined }));
vi.mock("./draft-removal-readiness", () => ({ loadDraftRemovalReadiness: () => mocks.loadDrafts() }));

import { readDashboardOverview } from "./dashboard-overview";

const FACILITY_ID = "7b1f0a0e-5d1c-4c47-9a53-3f0d1b6a2c11";
const ctx = { organizationId: "org-1" } as OrgContext;

describe("readDashboardOverview", () => {
  beforeEach(() => {
    mocks.loadDrafts = async () => [];
  });

  it("adds a draft row to the attention list", async () => {
    mocks.loadDrafts = async () => [
      { removalId: "r1", code: "RM-1", createdAt: new Date("2026-11-01T00:00:00Z"), readiness: { state: "ready", reasons: [] } },
    ];
    const result = await readDashboardOverview(ctx, { facilityId: FACILITY_ID });
    expect(result.attentionTotal).toBe(2);
  });

  it("still returns the overview when the draft readiness load rejects", async () => {
    mocks.loadDrafts = async () => {
      throw new Error("isometric down");
    };
    const result = await readDashboardOverview(ctx, { facilityId: FACILITY_ID });
    expect(result.attention).toEqual([{ id: "a1" }]);
    expect(result.attentionTotal).toBe(1);
  });
});
