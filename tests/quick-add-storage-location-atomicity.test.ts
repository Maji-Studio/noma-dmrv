import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, storageLocations } from "@/db/schema";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const getStorageLocationByIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/data-access/entities/storage-locations", () => ({
  getStorageLocationById: getStorageLocationByIdMock,
}));

import { createStorageLocation } from "@/data-access/quick-add";

beforeAll(() => ensureTestOrg());

describe("quick-add storage-location atomicity", () => {
  it("rolls back the insert when canonical enrichment fails", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const name = `Quick Add Enrichment Failure ${tag}`;
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-QA-FAIL-${tag}`,
        name: `Quick Add Enrichment Failure Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    getStorageLocationByIdMock.mockRejectedValueOnce(
      new Error("Injected enrichment failure"),
    );

    try {
      await expect(createStorageLocation(
        makeTestOrgContext("test-user-quick-add-atomicity"),
        {
          code: `BIN-QA-FAIL-${tag}`,
          name,
          type: "feedstock_bin",
          facilityId: facility.id,
        },
      )).rejects.toThrow("Injected enrichment failure");

      const [inserted] = await db
        .select({ id: storageLocations.id })
        .from(storageLocations)
        .where(eq(storageLocations.name, name));
      expect(inserted).toBeUndefined();
    } finally {
      await db.delete(storageLocations).where(eq(storageLocations.name, name));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });
});
