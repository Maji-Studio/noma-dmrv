import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes } from "@/db/schema";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const { ISOMETRIC_ID, ENTRY } = vi.hoisted(() => {
  const isometricId = "debug_duplicate_feedstock_type_019f8d83";
  return {
    ISOMETRIC_ID: isometricId,
    ENTRY: {
      id: isometricId,
      name: "Debug duplicate Isometric feedstock",
      supplier_reference_id: null,
    },
  };
});

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return {
    ...actual,
    requireOrgContext: vi.fn().mockResolvedValue(makeTestOrgContext()),
  };
});

vi.mock("@/data-access/certifier-credentials", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/data-access/certifier-credentials")>();
  return {
    ...actual,
    hasCertifierCredentials: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("@/lib/isometric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric")>();
  return {
    ...actual,
    getIsometricClientForOrg: vi.fn().mockResolvedValue({}),
    listFeedstockTypes: vi.fn().mockResolvedValue([ENTRY]),
  };
});

import { importIsometricFeedstockTypeFn } from "@/fn/feedstock-types";

beforeAll(async () => {
  await ensureTestOrg();
  await db
    .delete(feedstockTypes)
    .where(
      and(
        eq(feedstockTypes.organizationId, TEST_ORG_ID),
        eq(feedstockTypes.isometricFeedstockTypeId, ISOMETRIC_ID),
      ),
    );
});

afterAll(async () => {
  await db
    .delete(feedstockTypes)
    .where(
      and(
        eq(feedstockTypes.organizationId, TEST_ORG_ID),
        eq(feedstockTypes.isometricFeedstockTypeId, ISOMETRIC_ID),
      ),
    );
});

describe("Isometric feedstock import", () => {
  it("should explain that an already-imported catalogue entry cannot be imported again", async () => {
    const first = await importIsometricFeedstockTypeFn({
      isometricFeedstockTypeId: ISOMETRIC_ID,
      category: "forestry",
    });
    expect(first.success).toBe(true);

    const duplicate = await importIsometricFeedstockTypeFn({
      isometricFeedstockTypeId: ISOMETRIC_ID,
      category: "forestry",
    });

    expect(duplicate).toEqual({
      success: false,
      error: "This Isometric feedstock type has already been imported.",
    });
  });
});
