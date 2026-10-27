import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { certifierRemovals, feedstockTypes, type FeedstockType } from "@/db/schema";
import { getFeedstockTypeLinkLock, getLockedFeedstockTypeLinkLock } from "@/data-access/feedstock-type-link-lock";
import { getFeedstockTypeById, updateFeedstockType } from "@/data-access/feedstock-types";
import { getFeedstockTypeLinkLockFn } from "@/fn/feedstock-types";
import { requireOrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  cleanupLineageFixture,
  createLineageFixture,
  type LineageFixture,
} from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/server")>()),
  requireOrgContext: vi.fn(),
}));

const ctx = makeTestOrgContext();
const NOT_FOUND_MESSAGE = "Feedstock type was not found.";

async function removalCode(removalId: string): Promise<string> {
  const [row] = await db.select({ code: certifierRemovals.code }).from(certifierRemovals)
    .where(and(eq(certifierRemovals.id, removalId), eq(certifierRemovals.organizationId, ctx.organizationId)));
  return row.code;
}

async function withFeedstockTypeFixture(
  blockingVia: "removal" | "none",
  linked: boolean,
  run: (fixture: LineageFixture, type: FeedstockType) => Promise<void>,
): Promise<void> {
  const fixture = await createLineageFixture(blockingVia);
  try {
    // Seed the existing link directly, independent of the mutation under test.
    if (linked) {
      await db.update(feedstockTypes)
        .set({ isometricFeedstockTypeId: `fst_original_${fixture.feedstockTypeId}` })
        .where(and(
          eq(feedstockTypes.id, fixture.feedstockTypeId),
          eq(feedstockTypes.organizationId, ctx.organizationId),
        ));
    }
    await run(fixture, await getFeedstockTypeById(ctx, fixture.feedstockTypeId));
  } finally {
    await cleanupLineageFixture(fixture);
  }
}

describe("feedstock type Isometric link lock", () => {
  beforeAll(() => ensureTestOrg());
  beforeEach(() => {
    vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  });

  it.each(["removal", "none"] as const)("agrees between advisory and locked reads for %s", async (blockingVia) => {
    await withFeedstockTypeFixture(blockingVia, true, async (fixture) => {
      const expected = {
        locked: blockingVia === "removal",
        removals: blockingVia === "removal"
          ? [{ id: fixture.removalId, code: await removalCode(fixture.removalId), facilityId: fixture.facilityId }]
          : [],
      };
      const advisory = await getFeedstockTypeLinkLock(ctx, db, fixture.feedstockTypeId);
      const locked = await db.transaction(tx => getLockedFeedstockTypeLinkLock(ctx, tx, fixture.feedstockTypeId));
      expect(advisory).toEqual(expected);
      expect(locked).toEqual(advisory);
    });
  });

  it.each([
    ["changing", "fst_replacement"],
    ["clearing with null", null],
    ["clearing with an empty string", ""],
    ["clearing with whitespace", "   "],
  ] as const)("refuses %s a linked type in a sent Removal", async (_label, link) => {
    await withFeedstockTypeFixture("removal", true, async (fixture, type) => {
      const message = `The Isometric link cannot change because production runs of this feedstock type are in a sent Removal (${await removalCode(fixture.removalId)}).`;
      await expect(updateFeedstockType(ctx, {
        feedstockTypeId: fixture.feedstockTypeId,
        expectedVersion: type.version,
        isometricFeedstockTypeId: link,
        name: `${type.name} changed`,
      })).rejects.toMatchObject({
        code: "certification_locked",
        message,
        issues: [{ path: ["isometricFeedstockTypeId"], code: "certification_locked", message }],
      });
      expect(await getFeedstockTypeById(ctx, fixture.feedstockTypeId)).toMatchObject({
        name: type.name,
        version: type.version,
        isometricFeedstockTypeId: type.isometricFeedstockTypeId,
      });
    });
  });

  it.each([false, true])("allows the same link and a changed name (padded: %s)", async (padded) => {
    await withFeedstockTypeFixture("removal", true, async (fixture, type) => {
      const name = `${type.name} renamed`;
      const updated = await updateFeedstockType(ctx, {
        feedstockTypeId: fixture.feedstockTypeId,
        expectedVersion: type.version,
        isometricFeedstockTypeId: padded ? `  ${type.isometricFeedstockTypeId}  ` : type.isometricFeedstockTypeId,
        name,
      });
      expect(updated).toMatchObject({ name, isometricFeedstockTypeId: type.isometricFeedstockTypeId });
    });
  });

  it("allows other field edits when the link is omitted", async () => {
    await withFeedstockTypeFixture("removal", true, async (fixture, type) => {
      const description = "Updated feedstock description";
      expect(await updateFeedstockType(ctx, {
        feedstockTypeId: fixture.feedstockTypeId,
        expectedVersion: type.version,
        description,
      })).toMatchObject({ description, isometricFeedstockTypeId: type.isometricFeedstockTypeId });
    });
  });

  it("allows an unlinked type to be linked even when its run is in a sent Removal", async () => {
    await withFeedstockTypeFixture("removal", false, async (fixture, type) => {
      expect(type.isometricFeedstockTypeId).toBeNull();
      const link = `fst_first_${fixture.feedstockTypeId}`;
      expect(await updateFeedstockType(ctx, {
        feedstockTypeId: fixture.feedstockTypeId,
        expectedVersion: type.version,
        isometricFeedstockTypeId: `  ${link}  `,
      })).toMatchObject({ isometricFeedstockTypeId: link });
    });
  });

  it("allows a changed link when its runs are not in a sent Removal", async () => {
    await withFeedstockTypeFixture("none", true, async (fixture, type) => {
      expect(await getFeedstockTypeLinkLock(ctx, db, fixture.feedstockTypeId))
        .toEqual({ locked: false, removals: [] });
      const link = `fst_changed_${fixture.feedstockTypeId}`;
      expect(await updateFeedstockType(ctx, {
        feedstockTypeId: fixture.feedstockTypeId,
        expectedVersion: type.version,
        isometricFeedstockTypeId: `  ${link}  `,
      })).toMatchObject({ isometricFeedstockTypeId: link });
    });
  });

  it("refuses cross-org reads and writes without disclosing Removal references", async () => {
    await withFeedstockTypeFixture("removal", true, async (fixture, type) => {
      const foreign = { ...ctx, organizationId: "foreign-org" };
      await expect(getFeedstockTypeLinkLock(foreign, db, fixture.feedstockTypeId))
        .rejects.toThrow(SafeError);
      await expect(getFeedstockTypeLinkLock(foreign, db, fixture.feedstockTypeId))
        .rejects.toThrow(NOT_FOUND_MESSAGE);
      vi.mocked(requireOrgContext).mockResolvedValue(foreign);
      expect(await getFeedstockTypeLinkLockFn({ feedstockTypeId: fixture.feedstockTypeId }))
        .toEqual({ success: false, error: NOT_FOUND_MESSAGE });
      await expect(updateFeedstockType(foreign, {
        feedstockTypeId: fixture.feedstockTypeId,
        expectedVersion: type.version,
        isometricFeedstockTypeId: "fst_foreign",
      })).rejects.toThrow(NOT_FOUND_MESSAGE);
    });
  });

  it("reports the lock and Removal reference to an ordinary org member", async () => {
    await withFeedstockTypeFixture("removal", true, async (fixture) => {
      vi.mocked(requireOrgContext).mockResolvedValue({ ...ctx, orgRole: "member" });
      const expected = { locked: true, removals: [{ id: fixture.removalId, code: await removalCode(fixture.removalId), facilityId: fixture.facilityId }] };
      expect(await getFeedstockTypeLinkLock(ctx, db, fixture.feedstockTypeId)).toEqual(expected);
      expect(await getFeedstockTypeLinkLockFn({ feedstockTypeId: fixture.feedstockTypeId }))
        .toEqual({ success: true, data: expected });
    });
  });

  it("validates the read action input as a feedstock type UUID", async () => {
    expect(await getFeedstockTypeLinkLockFn({ feedstockTypeId: "invalid" }))
      .toMatchObject({ success: false, code: "validation_failed" });
    expect(await getFeedstockTypeLinkLockFn({}))
      .toMatchObject({ success: false, code: "validation_failed" });
  });
});
