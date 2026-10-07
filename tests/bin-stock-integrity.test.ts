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
  biocharProducts,
  facilities,
  feedstocks,
  feedstockTypes,
  formulations,
  organizations,
  productionRunFeedstockDraws,
  productionRuns,
  reactors,
  storageLocations,
  users,
} from "@/db/schema";
import { formatDateTime } from "@/lib/format-utils";
import { negativeLaneMessage } from "@/data-access/feedstock-bin-stock-integrity";
import { deleteOutputProductFixtures, outputProductFixtureValues } from "./helpers/output-contract-fixtures";
import { deleteFeedstockInTransaction, updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { updateStorageLocation } from "@/data-access/storage-locations";
import { cleanupPostedStock, postedStockFixture } from "./helpers/posted-output-stock-fixture";
import { lockBinStock } from "@/data-access/lock-bin-stocks";
import type { OrgContext } from "@/lib/auth/server";

const INTAKE_WET_KG = 100;
const FACILITY_CODE_SUFFIX_LENGTH = 4;
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
/** Small enough to leave the lane positive; the loss below drives it negative. */
const PRODUCT_DRAW_WET_KG = 5;
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

async function insertOtherFacility(organizationId: string, tag: string): Promise<string> {
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId,
      code: `E2E-BINT-F2-${tag}-${randomUUID().slice(0, FACILITY_CODE_SUFFIX_LENGTH).toUpperCase()}`,
      name: `E2E Bin integrity other facility ${tag}`,
    })
    .returning({ id: facilities.id });
  return facility.id;
}

async function recordLoss(fixture: Fixture, wetKg: number) {
  const [movement] = await db.insert(binMovements).values({
    organizationId: fixture.ctx.organizationId,
    storageLocationId: fixture.binId,
    lane: "feedstock",
    movementType: "loss",
    massDeltaKg: -wetKg,
    reason: "E2E bin integrity documented loss",
    createdBy: fixture.ctx.userId,
  }).returning();
  return {
    entity: "binMovement",
    id: movement.id,
    code: `${movement.reason} (${formatDateTime(movement.createdAt)})`,
  };
}

async function cleanup(fixture: Fixture): Promise<void> {
  const { organizationId } = fixture.ctx;
  if (!organizationId.startsWith(ORG_PREFIX)) {
    throw new Error("Expected an isolated bin-integrity test organization");
  }
  await db.transaction(async (tx) => {
    await deleteOutputProductFixtures(
      tx,
      eq(biocharProducts.organizationId, organizationId),
    );
    for (const table of [
      "bin_movements",
      "transport_legs",
      "production_run_feedstock_draws",
      "production_runs",
      "reactors",
      "feedstocks",
      "storage_locations",
      "formulations",
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
      facilityId: storageLocations.facilityId,
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
  it("refuses an intake reduction below a recorded loss and names it for review", async () => {
    const f = await fixture();
    const lossBlocker = await recordLoss(f, LOSS_WET_KG);

    await expect(
      db.transaction((tx) => updateFeedstockInTransaction(f.ctx, tx, f.feedstockId, { expectedVersion: 1,
        massWetKg: REDUCED_BELOW_LOSS_WET_KG,
        massDryKg: REDUCED_BELOW_LOSS_WET_KG * DRY_RATIO,
      })),
    ).rejects.toMatchObject({
      name: "ActionConflictError",
      message: `Feedstock was not saved. Bin ${binCodeOf(f)} would go ${SHORTFALL_AFTER_REDUCTION_KG} kg below zero. Review bin ${binCodeOf(f)} intake and withdrawal history, including recorded losses.`,
      blockers: [lossBlocker],
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

    const saved = await db.transaction((tx) => updateFeedstockInTransaction(f.ctx, tx, f.feedstockId, { expectedVersion: 1,
      massWetKg: REDUCED_TO_ZERO_WET_KG,
      massDryKg: REDUCED_TO_ZERO_WET_KG * DRY_RATIO,
    }));

    expect(saved.massWetKg).toBe(REDUCED_TO_ZERO_WET_KG);
    expect(await deriveFeedstockWetStockKg(f.ctx, db, f.binId)).toBe(0);
  });

  it("refuses a deletion that would leave the bin below zero", async () => {
    const f = await fixture();
    const lossBlocker = await recordLoss(f, LOSS_WET_KG);

    await expect(db.transaction((tx) => deleteFeedstockInTransaction(f.ctx, tx, f.feedstockId, 1))).rejects.toMatchObject({
      name: "ActionConflictError",
      message: negativeStockDeleteMessage(f),
      blockers: [lossBlocker],
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
      db.transaction((tx) => updateFeedstockInTransaction(f.ctx, tx, f.feedstockId, { expectedVersion: 1,
        massWetKg: REDUCED_BELOW_LOSS_WET_KG,
        massDryKg: REDUCED_BELOW_LOSS_WET_KG * DRY_RATIO,
      })),
    ).rejects.toMatchObject({
      name: "ActionConflictError",
      conflict: { entity: "storageLocation", id: f.binId, code: binCodeOf(f) },
      blockers: [{ entity: "productionRun", code: runCode }],
    });
  });

  it("lists only products whose composition takes a positive mass from the bin", async () => {
    const f = await fixture();
    const drawingCode = `E2E-BINT-BP-DRAW-${f.tag}`;
    const zeroCode = `E2E-BINT-BP-ZERO-${f.tag}`;
    await db.transaction(async (tx) => {
      const [formulation] = await tx
        .insert(formulations)
        .values({
          organizationId: f.ctx.organizationId,
          code: `E2E-BINT-FM-${f.tag}`,
          name: `E2E Bin integrity formulation ${f.tag}`,
        })
        .returning({ id: formulations.id });
      const productValues = await outputProductFixtureValues(tx, [
        {
          organizationId: f.ctx.organizationId,
          code: drawingCode,
          facilityId: f.facilityId,
          formulationId: formulation.id,
          composition: { ingredients: [{ storageLocationId: f.binId, massKg: PRODUCT_DRAW_WET_KG }] },
        },
        {
          organizationId: f.ctx.organizationId,
          code: zeroCode,
          facilityId: f.facilityId,
          formulationId: formulation.id,
          composition: { ingredients: [{ storageLocationId: f.binId, massKg: 0 }] },
        },
      ]);
      await tx.insert(biocharProducts).values(productValues);
    });
    const lossBlocker = await recordLoss(f, LOSS_WET_KG);

    await expect(
      db.transaction((tx) => updateFeedstockInTransaction(f.ctx, tx, f.feedstockId, { expectedVersion: 1,
        massWetKg: REDUCED_BELOW_LOSS_WET_KG,
        massDryKg: REDUCED_BELOW_LOSS_WET_KG * DRY_RATIO,
      })),
    ).rejects.toMatchObject({
      name: "ActionConflictError",
      blockers: [{ entity: "biocharProduct", code: drawingCode }, lossBlocker],
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
    const reduction = db.transaction((tx) => updateFeedstockInTransaction(f.ctx, tx, f.feedstockId, { expectedVersion: 1,
      massWetKg: REDUCED_BELOW_LOSS_WET_KG,
      massDryKg: REDUCED_BELOW_LOSS_WET_KG * DRY_RATIO,
    }));

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

  it("refuses a facility change while a feedstock bin holds stock", async () => {
    const f = await fixture(PROBE_STOCK_WET_KG);
    const otherFacilityId = await insertOtherFacility(f.ctx.organizationId, f.tag);

    await expect(
      updateStorageLocation(f.ctx, f.binId, { facilityId: otherFacilityId }),
    ).rejects.toThrow(stockBlocksMessage("Facility"));

    expect((await readBin(f)).facilityId).toBe(f.facilityId);
  });

  it("refuses a facility change on an emptied bin that keeps its history", async () => {
    const f = await fixture(PROBE_STOCK_WET_KG);
    await recordLoss(f, PROBE_STOCK_WET_KG);
    const otherFacilityId = await insertOtherFacility(f.ctx.organizationId, f.tag);

    await expect(
      updateStorageLocation(f.ctx, f.binId, { facilityId: otherFacilityId }),
    ).rejects.toThrow(historyBlocksMessage("Facility"));
  });

  it.each(["biochar", "product"] as const)(
    "refuses a facility change while a %s bin holds stock",
    async (lane) => {
      const posted = await postedStockFixture({ stockKg: PROBE_STOCK_WET_KG });
      try {
        const binId = lane === "biochar" ? posted.source.id : posted.bin.id;
        const otherFacilityId = await insertOtherFacility(posted.ctx.organizationId, posted.tag);

        await expect(
          updateStorageLocation(posted.ctx, binId, { facilityId: otherFacilityId }),
        ).rejects.toThrow(stockBlocksMessage("Facility"));

        const [bin] = await db
          .select({ facilityId: storageLocations.facilityId })
          .from(storageLocations)
          .where(eq(storageLocations.id, binId));
        expect(bin.facilityId).toBe(posted.facility.id);
      } finally {
        await cleanupPostedStock(posted);
      }
    },
  );

  it("moves an empty bin without history to another facility", async () => {
    const f = await fixture(PROBE_STOCK_WET_KG);
    const otherFacilityId = await insertOtherFacility(f.ctx.organizationId, f.tag);
    const [empty] = await db
      .insert(storageLocations)
      .values({
        organizationId: f.ctx.organizationId,
        facilityId: f.facilityId,
        code: `E2E-BINT-E-${f.tag}`,
        name: `E2E Bin integrity empty ${f.tag}`,
        type: "feedstock_bin",
        feedstockTypeId: f.otherFeedstockTypeId,
      })
      .returning({ id: storageLocations.id });

    const moved = await updateStorageLocation(f.ctx, empty.id, { facilityId: otherFacilityId });

    expect(moved.facilityId).toBe(otherFacilityId);
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
