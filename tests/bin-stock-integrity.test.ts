/**
 * Bin stock integrity (issue #767).
 *
 * Two derived-lane holes, both against the real database:
 *  - `updateFeedstock` / `deleteFeedstock` shrinking an intake below the
 *    withdrawals already recorded against the same bin (F06).
 *  - `updateStorageLocation` re-pointing a stocked bin's material lane through
 *    `type` or `feedstockTypeId` (F01).
 *
 * Every fixture owns a unique organization and deletes it again, so the suite
 * can share the local database with other agents.
 */

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements,
  facilities,
  feedstocks,
  feedstockTypes,
  organizations,
  productionRunFeedstockDraws,
  productionRuns,
  reactors,
  storageLocations,
  users,
} from "@/db/schema";
import { negativeLaneMessage } from "@/data-access/feedstock-bin-stock-integrity";
import { deleteFeedstock, updateFeedstock } from "@/data-access/feedstocks";
import { deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { updateStorageLocation } from "@/data-access/storage-locations";
import { lockBinStock } from "@/data-access/lock-bin-stocks";
import type { OrgContext } from "@/lib/auth/server";

const INTAKE_WET_KG = 100;
const INTAKE_DRY_KG = 80;
const MOISTURE_PERCENT = 20;
const LOSS_WET_KG = 80;
const REDUCED_BELOW_LOSS_WET_KG = 50;
const REDUCED_TO_ZERO_WET_KG = LOSS_WET_KG;
const DRY_RATIO = INTAKE_DRY_KG / INTAKE_WET_KG;
const PROBE_STOCK_WET_KG = 25;
const RENAMED_CAPACITY_KG = 4_000;
const LOCK_HOLD_PROBE_MS = 150;

const SHORTFALL_AFTER_REDUCTION_KG = LOSS_WET_KG - REDUCED_BELOW_LOSS_WET_KG;
const RUN_DRAW_WET_KG = LOSS_WET_KG;
const binCodeOf = (f: Fixture) => `E2E-BINT-B-${f.tag}`;
const negativeStockMessage = (f: Fixture) =>
  negativeLaneMessage("save", binCodeOf(f), SHORTFALL_AFTER_REDUCTION_KG);
const negativeStockDeleteMessage = (f: Fixture) =>
  negativeLaneMessage("delete", binCodeOf(f), LOSS_WET_KG);
/** The refusal names the field the operator moved, not always Storage type. */
const stockBlocksMessage = (changedField: string) =>
  "This bin still has stock in its current material lane. Its setup was not " +
  `changed. Review its stock and movement history before changing ${changedField}.`;
const historyBlocksMessage = (changedField: string) =>
  "This bin has stock history. Its setup was not changed. Review its stock " +
  `and movement history before changing ${changedField}.`;

const ORG_PREFIX = "e2e-bin-integrity-org-";

interface Fixture {
  tag: string;
  ctx: OrgContext;
  facilityId: string;
  binId: string;
  otherFeedstockTypeId: string;
  feedstockId: string;
}

async function seedFixture(intakeWetKg = INTAKE_WET_KG): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const organizationId = `${ORG_PREFIX}${tag}`;
  const userId = `e2e-bin-integrity-user-${tag}`;

  await db.insert(organizations).values({
    id: organizationId,
    name: `E2E Bin integrity ${tag}`,
    slug: `e2e-bin-integrity-${tag.toLowerCase()}`,
  });
  await db.insert(users).values({
    id: userId,
    name: "E2E bin integrity operator",
    email: `bin-integrity-${tag.toLowerCase()}@e2e.local`,
    emailVerified: true,
  });

  const ctx: OrgContext = {
    organizationId,
    userId,
    orgRole: "owner",
    isPlatformAdmin: false,
  };

  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId,
      code: `E2E-BINT-F-${tag}`,
      name: `E2E Bin integrity ${tag}`,
    })
    .returning({ id: facilities.id });

  const [feedstockType, otherFeedstockType] = await db
    .insert(feedstockTypes)
    .values([
      {
        organizationId,
        code: `E2E-BINT-T1-${tag}`,
        name: `E2E Bin integrity type A ${tag}`,
        category: "forestry" as const,
        usage: "pyrolysis" as const,
      },
      {
        organizationId,
        code: `E2E-BINT-T2-${tag}`,
        name: `E2E Bin integrity type B ${tag}`,
        category: "agricultural" as const,
        usage: "pyrolysis" as const,
      },
    ])
    .returning({ id: feedstockTypes.id });

  const [bin] = await db
    .insert(storageLocations)
    .values({
      organizationId,
      facilityId: facility.id,
      code: `E2E-BINT-B-${tag}`,
      name: `E2E Bin integrity bin ${tag}`,
      type: "feedstock_bin",
      feedstockTypeId: feedstockType.id,
      capacityKg: 10_000,
    })
    .returning({ id: storageLocations.id });

  const [feedstock] = await db
    .insert(feedstocks)
    .values({
      organizationId,
      code: `E2E-BINT-FS-${tag}`,
      facilityId: facility.id,
      status: "complete",
      feedstockTypeId: feedstockType.id,
      massDryKg: intakeWetKg * DRY_RATIO,
      massWetKg: intakeWetKg,
      moistureContentPercent: MOISTURE_PERCENT,
      storageLocationId: bin.id,
    })
    .returning({ id: feedstocks.id });

  return {
    tag,
    ctx,
    facilityId: facility.id,
    binId: bin.id,
    otherFeedstockTypeId: otherFeedstockType.id,
    feedstockId: feedstock.id,
  };
}

async function recordLoss(fixture: Fixture, wetKg: number): Promise<void> {
  await db.insert(binMovements).values({
    organizationId: fixture.ctx.organizationId,
    storageLocationId: fixture.binId,
    lane: "feedstock",
    movementType: "loss",
    massDeltaKg: -wetKg,
    reason: "E2E bin integrity documented loss",
    createdBy: fixture.ctx.userId,
  });
}

async function cleanup(fixture: Fixture): Promise<void> {
  const { organizationId } = fixture.ctx;
  if (!organizationId.startsWith(ORG_PREFIX)) {
    throw new Error("Expected an isolated bin-integrity test organization");
  }
  await db.transaction(async (tx) => {
    for (const table of [
      "bin_movements",
      "transport_legs",
      "production_run_feedstock_draws",
      "production_runs",
      "reactors",
      "feedstocks",
      "storage_locations",
      "feedstock_types",
      "facilities",
    ]) {
      await tx.execute(
        sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`,
      );
    }
    await tx.delete(organizations).where(eq(organizations.id, organizationId));
    await tx.delete(users).where(eq(users.id, fixture.ctx.userId));
  });
}

async function readBin(fixture: Fixture) {
  const [bin] = await db
    .select({
      name: storageLocations.name,
      type: storageLocations.type,
      capacityKg: storageLocations.capacityKg,
      feedstockTypeId: storageLocations.feedstockTypeId,
    })
    .from(storageLocations)
    .where(eq(storageLocations.id, fixture.binId));
  return bin;
}

async function readFeedstockWetKg(fixture: Fixture): Promise<number | null> {
  const [row] = await db
    .select({ massWetKg: feedstocks.massWetKg })
    .from(feedstocks)
    .where(eq(feedstocks.id, fixture.feedstockId));
  return row?.massWetKg ?? null;
}

/** True while `promise` has neither resolved nor rejected after `ms`. */
async function stillPending(
  promise: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  const pending = Symbol("pending");
  const settled = promise.then(
    () => "settled",
    () => "settled",
  );
  const timer = new Promise<symbol>((resolve) => {
    setTimeout(() => resolve(pending), ms);
  });
  return (await Promise.race([settled, timer])) === pending;
}

const fixtures: Fixture[] = [];
async function fixture(intakeWetKg?: number): Promise<Fixture> {
  const created = await seedFixture(intakeWetKg);
  fixtures.push(created);
  return created;
}
afterEach(async () => {
  for (const created of fixtures.splice(0)) await cleanup(created);
});

describe("feedstock writes cannot drive a bin lane negative", () => {
  it("refuses an intake reduction below the withdrawals already recorded", async () => {
    const f = await fixture();
    await recordLoss(f, LOSS_WET_KG);

    await expect(
      updateFeedstock(f.ctx, f.feedstockId, {
        massWetKg: REDUCED_BELOW_LOSS_WET_KG,
        massDryKg: REDUCED_BELOW_LOSS_WET_KG * DRY_RATIO,
      }),
    ).rejects.toMatchObject({
      name: "ActionConflictError",
      message: negativeStockMessage(f),
      conflict: { entity: "storageLocation", id: f.binId, code: binCodeOf(f) },
    });

    expect(await readFeedstockWetKg(f)).toBe(INTAKE_WET_KG);
    expect(await deriveFeedstockWetStockKg(f.ctx, db, f.binId)).toBe(
      INTAKE_WET_KG - LOSS_WET_KG,
    );

    // The lane is derived and deliberately unclamped, so the same edit written
    // without the guard really does leave the bin below zero. Rolled back.
    let unguardedStockKg: number | undefined;
    await db
      .transaction(async (tx) => {
        await tx
          .update(feedstocks)
          .set({
            massWetKg: REDUCED_BELOW_LOSS_WET_KG,
            massDryKg: REDUCED_BELOW_LOSS_WET_KG * DRY_RATIO,
          })
          .where(eq(feedstocks.id, f.feedstockId));
        unguardedStockKg = await deriveFeedstockWetStockKg(
          f.ctx,
          tx,
          f.binId,
        );
        tx.rollback();
      })
      .catch((error) => {
        if (unguardedStockKg === undefined) throw error;
      });
    expect(unguardedStockKg).toBe(REDUCED_BELOW_LOSS_WET_KG - LOSS_WET_KG);
  });

  it("accepts a reduction that lands on exactly zero", async () => {
    const f = await fixture();
    await recordLoss(f, LOSS_WET_KG);

    const saved = await updateFeedstock(f.ctx, f.feedstockId, {
      massWetKg: REDUCED_TO_ZERO_WET_KG,
      massDryKg: REDUCED_TO_ZERO_WET_KG * DRY_RATIO,
    });

    expect(saved.massWetKg).toBe(REDUCED_TO_ZERO_WET_KG);
    expect(await deriveFeedstockWetStockKg(f.ctx, db, f.binId)).toBe(0);
  });

  it("refuses a deletion that would leave the bin below zero", async () => {
    const f = await fixture();
    await recordLoss(f, LOSS_WET_KG);

    await expect(deleteFeedstock(f.ctx, f.feedstockId)).rejects.toMatchObject({
      name: "ActionConflictError",
      message: negativeStockDeleteMessage(f),
      conflict: { entity: "storageLocation", id: f.binId, code: binCodeOf(f) },
    });

    expect(await readFeedstockWetKg(f)).toBe(INTAKE_WET_KG);
  });

  it("lists the production runs still drawing on the bin as blockers", async () => {
    const f = await fixture();
    const runCode = `E2E-BINT-PR-${f.tag}`;
    await db.transaction(async (tx) => {
      const [reactor] = await tx
        .insert(reactors)
        .values({
          organizationId: f.ctx.organizationId,
          facilityId: f.facilityId,
          code: `E2E-BINT-RE-${f.tag}`,
          identifier: `E2E Bin integrity reactor ${f.tag}`,
          reactorType: "fixed-bed",
        })
        .returning({ id: reactors.id });
      const [run] = await tx
        .insert(productionRuns)
        .values({
          organizationId: f.ctx.organizationId,
          facilityId: f.facilityId,
          reactorId: reactor.id,
          code: runCode,
          startTime: new Date("2025-06-15T08:00:00Z"),
          endTime: new Date("2025-06-15T12:00:00Z"),
        })
        .returning({ id: productionRuns.id });
      await tx.insert(productionRunFeedstockDraws).values({
        organizationId: f.ctx.organizationId,
        productionRunId: run.id,
        storageLocationId: f.binId,
        wetMassKg: RUN_DRAW_WET_KG,
      });
    });

    await expect(
      updateFeedstock(f.ctx, f.feedstockId, {
        massWetKg: REDUCED_BELOW_LOSS_WET_KG,
        massDryKg: REDUCED_BELOW_LOSS_WET_KG * DRY_RATIO,
      }),
    ).rejects.toMatchObject({
      name: "ActionConflictError",
      conflict: { entity: "storageLocation", id: f.binId, code: binCodeOf(f) },
      blockers: [{ entity: "productionRun", code: runCode }],
    });
  });

  it("serializes an intake reduction behind a concurrent withdrawal", async () => {
    const f = await fixture();
    let releaseWithdrawal!: () => void;
    const withdrawalHeld = new Promise<void>((resolve) => {
      releaseWithdrawal = resolve;
    });
    let withdrawalLocked!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      withdrawalLocked = resolve;
    });

    const withdrawal = db.transaction(async (tx) => {
      await lockBinStock(f.ctx, tx, f.binId);
      await tx.insert(binMovements).values({
        organizationId: f.ctx.organizationId,
        storageLocationId: f.binId,
        lane: "feedstock",
        movementType: "loss",
        massDeltaKg: -LOSS_WET_KG,
        reason: "E2E bin integrity concurrent loss",
        createdBy: f.ctx.userId,
      });
      withdrawalLocked();
      await withdrawalHeld;
    });

    await lockAcquired;
    const reduction = updateFeedstock(f.ctx, f.feedstockId, {
      massWetKg: REDUCED_BELOW_LOSS_WET_KG,
      massDryKg: REDUCED_BELOW_LOSS_WET_KG * DRY_RATIO,
    });

    // The reduction cannot read the lane until the withdrawal commits.
    expect(await stillPending(reduction, LOCK_HOLD_PROBE_MS)).toBe(true);
    releaseWithdrawal();
    await withdrawal;

    await expect(reduction).rejects.toMatchObject({
      name: "ActionConflictError",
      message: negativeStockMessage(f),
    });
    expect(await readFeedstockWetKg(f)).toBe(INTAKE_WET_KG);
    expect(await deriveFeedstockWetStockKg(f.ctx, db, f.binId)).toBe(
      INTAKE_WET_KG - LOSS_WET_KG,
    );
  });
});

describe("a stocked bin keeps the setup its stock was recorded against", () => {
  it("refuses a feedstock-type change while the bin holds stock", async () => {
    const f = await fixture(PROBE_STOCK_WET_KG);

    await expect(
      updateStorageLocation(f.ctx, f.binId, {
        feedstockTypeId: f.otherFeedstockTypeId,
      }),
    ).rejects.toThrow(stockBlocksMessage("Feedstock type"));

    const bin = await readBin(f);
    expect(bin.feedstockTypeId).not.toBe(f.otherFeedstockTypeId);
    expect(await deriveFeedstockWetStockKg(f.ctx, db, f.binId)).toBe(
      PROBE_STOCK_WET_KG,
    );
  });

  it("refuses a storage-type change while the bin holds stock", async () => {
    const f = await fixture(PROBE_STOCK_WET_KG);

    await expect(
      updateStorageLocation(f.ctx, f.binId, { type: "biochar_bin" }),
    ).rejects.toThrow(stockBlocksMessage("Storage type"));

    expect((await readBin(f)).type).toBe("feedstock_bin");
  });

  it("still saves a rename and other metadata on a stocked bin", async () => {
    const f = await fixture(PROBE_STOCK_WET_KG);
    const name = `E2E Bin integrity renamed ${f.tag}`;

    const updated = await updateStorageLocation(f.ctx, f.binId, {
      name,
      capacityKg: RENAMED_CAPACITY_KG,
      storageDescription: "Covered concrete bay",
    });

    expect(updated.name).toBe(name);
    const bin = await readBin(f);
    expect(bin.name).toBe(name);
    expect(bin.capacityKg).toBe(RENAMED_CAPACITY_KG);
    expect(bin.type).toBe("feedstock_bin");
  });

  it("serializes an identity change behind a concurrent withdrawal", async () => {
    const f = await fixture(PROBE_STOCK_WET_KG);
    let releaseWithdrawal!: () => void;
    const withdrawalHeld = new Promise<void>((resolve) => {
      releaseWithdrawal = resolve;
    });
    let withdrawalLocked!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      withdrawalLocked = resolve;
    });

    const withdrawal = db.transaction(async (tx) => {
      await lockBinStock(f.ctx, tx, f.binId);
      await tx.insert(binMovements).values({
        organizationId: f.ctx.organizationId,
        storageLocationId: f.binId,
        lane: "feedstock",
        movementType: "loss",
        massDeltaKg: -PROBE_STOCK_WET_KG,
        reason: "E2E bin integrity concurrent drawdown",
        createdBy: f.ctx.userId,
      });
      withdrawalLocked();
      await withdrawalHeld;
    });

    await lockAcquired;
    const identityChange = updateStorageLocation(f.ctx, f.binId, {
      feedstockTypeId: f.otherFeedstockTypeId,
    });

    expect(await stillPending(identityChange, LOCK_HOLD_PROBE_MS)).toBe(true);
    releaseWithdrawal();
    await withdrawal;

    // Refused on history, not stock: the identity change read the lane only
    // after the withdrawal committed, so it saw the emptied bin.
    await expect(identityChange).rejects.toThrow(
      historyBlocksMessage("Feedstock type"),
    );
    const bin = await readBin(f);
    expect(bin.feedstockTypeId).not.toBe(f.otherFeedstockTypeId);
    expect(await deriveFeedstockWetStockKg(f.ctx, db, f.binId)).toBe(0);
  });
});
