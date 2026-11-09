import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import type { RemovalAttentionRows } from "@/lib/certification/removal-attention";

// Plain functions, not vi.fn: vitest reports a rejecting spy as an unhandled error even when the caller catches it.
const mocks = vi.hoisted(() => ({
  loadSources: async (): Promise<unknown> => ({ drafts: [], rejected: [], returned: [] }),
  passed: null as Promise<unknown> | null,
}));

vi.mock("@/data-access/dashboard-overview", () => ({
  getDashboardOverview: async (_ctx: unknown, _facility: unknown, _range: unknown, removalAttention: Promise<unknown>) => {
    mocks.passed = removalAttention;
    return { attention: [], attentionTotal: 0 };
  },
}));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: async () => undefined }));
vi.mock("./removal-attention-sources", () => ({ loadRemovalAttentionSources: () => mocks.loadSources() }));

import { readDashboardOverview } from "./dashboard-overview";

const FACILITY_ID = "7b1f0a0e-5d1c-4c47-9a53-3f0d1b6a2c11";
const ctx = { organizationId: "org-1" } as OrgContext;

describe("readDashboardOverview", () => {
  beforeEach(() => {
    mocks.loadSources = async () => ({ drafts: [], rejected: [], returned: [] });
    mocks.passed = null;
  });

  it("hands the data-access aggregate the draft, rejected and returned Removal rows", async () => {
    mocks.loadSources = async () => ({
      drafts: [{ removalId: "r1", code: "RM-1", createdAt: new Date("2026-11-01T00:00:00Z"), readiness: { state: "ready", reasons: [] } }],
      rejected: [],
      returned: [],
    });
    await readDashboardOverview(ctx, { facilityId: FACILITY_ID });
    const rows = (await mocks.passed) as RemovalAttentionRows;
    expect(rows.drafts.map((row) => row.title)).toEqual(["Ready to submit"]);
  });

  it("still returns the overview, with no Removal rows, when the readiness load rejects", async () => {
    mocks.loadSources = async () => {
      throw new Error("isometric down");
    };
    const result = await readDashboardOverview(ctx, { facilityId: FACILITY_ID });
    expect(result.attentionTotal).toBe(0);
    expect(await mocks.passed).toEqual({ drafts: [], rejected: [], returned: [], covered: new Set() });
  });
});
