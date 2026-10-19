import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { REMOVAL_REGISTRY_DELETION_MIN_ROLE } from "@/lib/certification/removal-deletion-role";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { readFacilityCertifierSummary } from "./facility-certifier-summary";

vi.mock("@/data-access/certification", () => ({
  getCertifierProjectByFacility: vi.fn().mockResolvedValue(null),
  listFacilitiesLinkedToExternal: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/data-access/utils", () => ({
  requireOrgFacility: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return { ...actual, env: { ...actual.env, ISOMETRIC_ENVIRONMENT: "sandbox" } };
});

const FACILITY_ID = "6fc1a524-e694-4f13-99df-c280cdd06aab";
const viewers: Array<{
  name: string;
  ctx: OrgContext;
  canDeleteRegistryRemovals: boolean;
}> = [
  {
    name: "member",
    ctx: { ...makeTestOrgContext(), orgRole: "member" },
    canDeleteRegistryRemovals: false,
  },
  {
    name: "admin",
    ctx: { ...makeTestOrgContext(), orgRole: REMOVAL_REGISTRY_DELETION_MIN_ROLE },
    canDeleteRegistryRemovals: true,
  },
  {
    name: "owner",
    ctx: makeTestOrgContext(),
    canDeleteRegistryRemovals: true,
  },
  {
    name: "platform admin outside the organization",
    ctx: { ...makeTestOrgContext(), orgRole: null, isPlatformAdmin: true },
    canDeleteRegistryRemovals: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readFacilityCertifierSummary deletion permission", () => {
  it.each(viewers)(
    "$name: viewerCanDeleteRegistryRemovals is $canDeleteRegistryRemovals",
    async ({ ctx, canDeleteRegistryRemovals }) => {
      const summary = await readFacilityCertifierSummary(ctx, FACILITY_ID);

      expect(summary).toHaveProperty(
        "viewerCanDeleteRegistryRemovals",
        canDeleteRegistryRemovals,
      );
    },
  );
});
