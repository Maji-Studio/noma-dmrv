/**
 * Feedstock loss idempotency against a real database (issue #773).
 *
 * The bin-movement ledger is append-only, so a resubmitted loss form must
 * replay the saved movement instead of posting a second deduction. Each case
 * seeds its own organization and bin so concurrent suites cannot collide.
 */

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements,
  facilities,
  feedstocks,
  feedstockTypes,
  organizations,
  storageLocations,
  users,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({
  ctx: {
    userId: "",
    organizationId: "",
    orgRole: "owner",
    isPlatformAdmin: false,
  } as OrgContext,
}));

vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/server")>()),
  requireOrgContext: vi.fn(async () => mocks.ctx),
}));

import { recordLossFn } from "@/fn/bin-movements";

const AVAILABLE_STOCK_KG = 1000;
const LOSS_KG = 120;
const OTHER_LOSS_KG = 45;
const CHANGED_LOSS_KG = 250;

const seededOrganizations: string[] = [];

async function seedFeedstockBin() {
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const organizationId = `e2e-loss-org-${tag}`;
  const userId = `e2e-loss-user-${tag}`;
  await db
    .insert(organizations)
    .values({
      id: organizationId,
      name: `E2E Loss ${tag}`,
      slug: `e2e-loss-${tag.toLowerCase()}`,
    });
  await db.insert(users).values({
    id: userId,
    name: "E2E Loss operator",
    email: `loss-${tag.toLowerCase()}@e2e.local`,
    emailVerified: true,
  });
  seededOrganizations.push(organizationId);

  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId,
      code: `E2E-LOSS-F-${tag}`,
      name: `E2E Loss facility ${tag}`,
    })
    .returning();
  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      organizationId,
      code: `E2E-LOSS-T-${tag}`,
      name: `E2E Loss feedstock ${tag}`,
      category: "forestry",
    })
    .returning();
  const [bin] = await db
    .insert(storageLocations)
    .values({
      organizationId,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      code: `E2E-LOSS-B-${tag}`,
      name: `E2E Loss bin ${tag}`,
      type: "feedstock_bin",
    })
    .returning();
  await db.insert(feedstocks).values({
    organizationId,
    facilityId: facility.id,
    feedstockTypeId: feedstockType.id,
    storageLocationId: bin.id,
    code: `E2E-LOSS-S-${tag}`,
    status: "complete",
    massDryKg: AVAILABLE_STOCK_KG,
    massWetKg: AVAILABLE_STOCK_KG,
  });

  mocks.ctx = {
    userId,
    organizationId,
    orgRole: "owner",
    isPlatformAdmin: false,
  };
  return { organizationId, binId: bin.id };
}

async function movementsFor(organizationId: string, binId: string) {
  return db
    .select()
    .from(binMovements)
    .where(
      and(
        eq(binMovements.organizationId, organizationId),
        eq(binMovements.storageLocationId, binId),
      ),
    );
}

afterAll(async () => {
  for (const organizationId of seededOrganizations) {
    await db
      .delete(binMovements)
      .where(eq(binMovements.organizationId, organizationId));
    await db
      .delete(feedstocks)
      .where(eq(feedstocks.organizationId, organizationId));
    await db
      .delete(storageLocations)
      .where(eq(storageLocations.organizationId, organizationId));
    await db
      .delete(feedstockTypes)
      .where(eq(feedstockTypes.organizationId, organizationId));
    await db
      .delete(facilities)
      .where(eq(facilities.organizationId, organizationId));
    await db
      .delete(users)
      .where(eq(users.id, organizationId.replace("-org-", "-user-")));
    await db
      .delete(organizations)
      .where(eq(organizations.id, organizationId));
  }
});

describe("feedstock loss idempotency", () => {
  it("replays the saved movement and refuses the key with changed values", async () => {
    const { organizationId, binId } = await seedFeedstockBin();
    const idempotencyKey = randomUUID();
    const loss = {
      storageLocationId: binId,
      lane: "feedstock" as const,
      idempotencyKey,
      reason: "Spoiled load",
      lossMassKg: LOSS_KG,
    };

    const first = await recordLossFn(loss);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const replay = await recordLossFn(loss);
    expect(replay.success).toBe(true);
    if (!replay.success) return;
    expect(replay.data.id).toBe(first.data.id);
    expect(Number(replay.data.massDeltaKg)).toBe(-LOSS_KG);
    expect(await movementsFor(organizationId, binId)).toHaveLength(1);

    const changed = await recordLossFn({ ...loss, lossMassKg: CHANGED_LOSS_KG });
    expect(changed).toMatchObject({
      success: false,
      error:
        "Loss was not saved because this request was already saved with different values. Start a new loss entry.",
      conflict: { entity: "storageLocation", id: binId },
    });
    expect(await movementsFor(organizationId, binId)).toHaveLength(1);

    const changedReason = await recordLossFn({
      ...loss,
      reason: "Different reason",
    });
    expect(changedReason.success).toBe(false);
    expect(await movementsFor(organizationId, binId)).toHaveLength(1);
  });

  it("posts a separate movement for a new request key", async () => {
    const { organizationId, binId } = await seedFeedstockBin();
    const first = await recordLossFn({
      storageLocationId: binId,
      lane: "feedstock",
      idempotencyKey: randomUUID(),
      reason: "Transfer spill",
      lossMassKg: LOSS_KG,
    });
    const second = await recordLossFn({
      storageLocationId: binId,
      lane: "feedstock",
      idempotencyKey: randomUUID(),
      reason: "Transfer spill",
      lossMassKg: OTHER_LOSS_KG,
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(second.data.id).not.toBe(first.data.id);

    const rows = await movementsFor(organizationId, binId);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + Number(row.massDeltaKg), 0)).toBe(
      -(LOSS_KG + OTHER_LOSS_KG),
    );
  });

  it("inserts one movement when identical submits race", async () => {
    const { organizationId, binId } = await seedFeedstockBin();
    const loss = {
      storageLocationId: binId,
      lane: "feedstock" as const,
      idempotencyKey: randomUUID(),
      reason: "Double submit",
      lossMassKg: LOSS_KG,
    };

    const [left, right] = await Promise.all([
      recordLossFn(loss),
      recordLossFn(loss),
    ]);

    expect(left.success).toBe(true);
    expect(right.success).toBe(true);
    if (!left.success || !right.success) return;
    expect(right.data.id).toBe(left.data.id);
    expect(await movementsFor(organizationId, binId)).toHaveLength(1);
  });
});
