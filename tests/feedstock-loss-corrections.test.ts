/**
 * Issue #773: real-DB contracts through the server actions. Every case owns its
 * organization, member, facility and bin. Stored rows are inspected only for
 * the bounded reversal, append-only writes, idempotency and rollback contracts.
 * Do not run this suite without a migrated throwaway test database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements, facilities, feedstocks, feedstockTypes, organizations,
  productionRunFeedstockDraws, productionRunFeedstocks, productionRuns,
  reactors, storageLocations, users, type BinMovement,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { ActionResult } from "@/types/actions";
import { formatFacilityDateTime } from "@/lib/format-utils";
import { feedstockFixtureValues, cleanupFeedstockFixtureParents } from "./helpers/feedstock-fixture";
import { TEST_SITE_POSITION } from "./helpers/test-org";

const mocks = vi.hoisted(() => ({ ctx: {} as OrgContext }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/server")>()),
  requireOrgContext: vi.fn(async () => mocks.ctx),
}));

import { getFeedstockBinStockFn, recordLossFn, removeLossFn } from "@/fn/bin-movements";

const INITIAL_KG = 1000;
const LOSS_KG = 120;
const FRACTIONAL_LOSS_KG = 120.125;
const REPLACEMENT_KG = 80;
const LARGER_LOSS_KG = 200;
const DRAW_KG = 100;
const LATER_LOSS_KG = 40;
const OVERDRAW_KG = 1001;
const AFTER_LOSS_KG = 880;
const AFTER_EDIT_KG = 920;
const AFTER_LARGER_EDIT_KG = 800;
const AFTER_DRAW_EDIT_KG = 820;
const AFTER_TWO_LOSSES_KG = 840;
const AFTER_LATER_INTAKE_EDIT_KG = 1920;
const ORIGINAL_ROWS = 1;
const REMOVAL_ROWS = 2;
const EDIT_ROWS = 3;
const SINGLE_ROW = 1;
const TAG_LENGTH = 8;
const SUITE_TIMEOUT_MS = 30_000;
const FUTURE_OFFSET_MS = 86_400_000;
const INTAKE_AT = "2026-01-01T00:00:00.000Z";
const BEFORE_INTAKE_AT = "2025-12-31T10:00:00.000Z";
const BEFORE_LOSS_AT = "2026-01-01T08:00:00.000Z";
const BEFORE_DRAW_AT = "2026-01-01T07:00:00.000Z";
const BETWEEN_DRAW_AND_LOSS_AT = "2026-01-01T09:00:00.000Z";
const LOSS_AT = "2026-01-01T10:00:00.000Z";
const EDIT_AT = "2026-01-01T11:00:00.000Z";
const LATER_AT = "2026-01-01T12:00:00.000Z";
const LATER_INTAKE_AT = "2026-01-02T00:00:00.000Z";
const REASON = "Corrected scale reading";
const ACTOR_NAME = "E2E Lost mass member";
const seeded: { organizationId: string; userId: string }[] = [];

function saved<T>(result: ActionResult<T>): T {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function seedBin() {
  const tag = randomUUID().slice(0, TAG_LENGTH).toUpperCase();
  const organizationId = `e2e-loss-correction-org-${tag}`;
  const userId = `e2e-loss-correction-user-${tag}`;
  await db.insert(organizations).values({ id: organizationId, name: `E2E Lost mass ${tag}`, slug: organizationId.toLowerCase() });
  seeded.push({ organizationId, userId });
  await db.insert(users).values({ id: userId, name: ACTOR_NAME, email: `${userId.toLowerCase()}@e2e.local`, emailVerified: true });
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION, organizationId, code: `E2E-F-${tag}`, name: `E2E Facility ${tag}`, timezone: "UTC",
  }).returning();
  const [feedstockType] = await db.insert(feedstockTypes).values({
    organizationId, code: `E2E-T-${tag}`, name: `E2E Feedstock ${tag}`, category: "forestry", usage: "pyrolysis",
  }).returning();
  const [bin] = await db.insert(storageLocations).values({
    organizationId, facilityId: facility.id, feedstockTypeId: feedstockType.id,
    code: `E2E-B-${tag}`, name: `E2E Bin ${tag}`, type: "feedstock_bin",
  }).returning();
  const [intake] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
    organizationId, facilityId: facility.id, feedstockTypeId: feedstockType.id,
    storageLocationId: bin.id, code: `E2E-FS-${tag}`, status: "complete",
    massWetKg: INITIAL_KG, massDryKg: INITIAL_KG, moistureContentPercent: 0, deliveryDate: new Date(INTAKE_AT),
  })).returning();
  const ctx: OrgContext = { userId, organizationId, orgRole: "member", isPlatformAdmin: false };
  mocks.ctx = ctx;
  return { ctx, tag, facility, feedstockType, bin, intake };
}

type Fixture = Awaited<ReturnType<typeof seedBin>>;

function lossInput(f: Fixture, overrides: Partial<{ occurredAt: string; lossMassKg: number }> = {}) {
  return { storageLocationId: f.bin.id, lane: "feedstock" as const, idempotencyKey: randomUUID(),
    reason: "Spillage", occurredAt: LOSS_AT, lossMassKg: LOSS_KG, ...overrides };
}

function editInput(f: Fixture, correctsMovementId: string) {
  return { ...lossInput(f), correctsMovementId, reason: REASON, lossMassKg: REPLACEMENT_KG, occurredAt: EDIT_AT };
}

function removeInput(f: Fixture, correctsMovementId: string) {
  return { storageLocationId: f.bin.id, correctsMovementId, reason: REASON, idempotencyKey: randomUUID() };
}

async function recordOriginal(f: Fixture) {
  return saved(await recordLossFn(lossInput(f)));
}

async function ledger(f: Fixture) {
  return saved(await getFeedstockBinStockFn(f.bin.id));
}

async function rows(f: Fixture) {
  return db.select().from(binMovements).where(and(
    eq(binMovements.organizationId, f.ctx.organizationId), eq(binMovements.storageLocationId, f.bin.id),
  ));
}

async function seedSiblingBin(f: Fixture) {
  const [bin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId,
    facilityId: f.facility.id, feedstockTypeId: f.feedstockType.id,
    code: `E2E-OTHER-${f.tag}`, name: "E2E Other bin", type: "feedstock_bin",
  }).returning();
  return bin;
}

async function seedRunDraw(f: Fixture, occurredAt: string) {
  // Same canonical bin draw + batch provenance fixture pattern as
  // tests/helpers/api-feedstock-fixture.ts:seedFeedstockDraw.
  const [reactor] = await db.insert(reactors).values({
    organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    code: `E2E-R-${f.tag}`, identifier: `E2E Reactor ${f.tag}`, reactorType: "auger",
  }).returning();
  const [run] = await db.insert(productionRuns).values({
    organizationId: f.ctx.organizationId, facilityId: f.facility.id, reactorId: reactor.id,
    code: `E2E-PR-${f.tag}`, status: "running", startTime: new Date(occurredAt),
    feedstockWetMassKg: DRAW_KG, feedstockMassDryKg: DRAW_KG, feedstockMoisturePercent: 0,
  }).returning();
  await db.insert(productionRunFeedstockDraws).values({
    organizationId: f.ctx.organizationId, productionRunId: run.id, storageLocationId: f.bin.id, wetMassKg: DRAW_KG,
  });
  await db.insert(productionRunFeedstocks).values({
    organizationId: f.ctx.organizationId, productionRunId: run.id, feedstockId: f.intake.id, wetMassUsedKg: DRAW_KG,
  });
  return run;
}

async function expectBothCorrectionsRefused(f: Fixture, movementId: string) {
  const before = await rows(f);
  const stockBefore = await ledger(f);
  const results = [await recordLossFn(editInput(f, movementId)), await removeLossFn(removeInput(f, movementId))];
  for (const result of results) {
    expect(result).toMatchObject({ success: false, error: expect.any(String) });
    if (result.success) throw new Error("Expected this correction target to be refused");
    // A swallowed programming/DB error must not satisfy a refusal contract.
    expect(result.error).not.toMatch(/^Failed to /);
  }
  expect(await rows(f)).toHaveLength(before.length);
  expect(await ledger(f)).toEqual(stockBefore);
}

afterAll(async () => {
  for (const { organizationId, userId } of seeded) {
    await db.delete(binMovements).where(eq(binMovements.organizationId, organizationId));
    await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.organizationId, organizationId));
    await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, organizationId));
    await db.delete(productionRuns).where(eq(productionRuns.organizationId, organizationId));
    await db.delete(reactors).where(eq(reactors.organizationId, organizationId));
    await db.delete(feedstocks).where(eq(feedstocks.organizationId, organizationId));
    await cleanupFeedstockFixtureParents(db);
    await db.delete(storageLocations).where(eq(storageLocations.organizationId, organizationId));
    await db.delete(feedstockTypes).where(eq(feedstockTypes.organizationId, organizationId));
    await db.delete(facilities).where(eq(facilities.organizationId, organizationId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
});

describe("feedstock Lost mass corrections", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("lets a member replace 120 kg with 80 kg and replays the ledger and pile as 920 kg", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const replacement = saved(await recordLossFn(editInput(f, original.id)));
    expect(replacement.id).not.toBe(original.id);
    const stored = await rows(f);
    expect(stored).toHaveLength(EDIT_ROWS);
    const reversal = stored.find(row => row.movementType === "adjustment")!;
    expect(reversal).toMatchObject({ correctsMovementId: original.id, massDeltaKg: LOSS_KG,
      occurredAt: original.occurredAt, reason: REASON, createdBy: f.ctx.userId, lane: "feedstock", outputKind: null });
    expect(stored.find(row => row.id === original.id)).toEqual(original);
    expect(stored.find(row => row.id === replacement.id)).toMatchObject({
      movementType: "loss", correctsMovementId: original.id, massDeltaKg: -REPLACEMENT_KG,
      occurredAt: new Date(EDIT_AT), reason: REASON, createdBy: f.ctx.userId, lane: "feedstock", outputKind: null,
    });
    const stock = await ledger(f);
    expect(stock.currentWetKg).toBe(AFTER_EDIT_KG);
    expect(stock.entries).toEqual([
      expect.objectContaining({ id: f.intake.id, kind: "intake", beforeWetKg: 0, afterWetKg: INITIAL_KG }),
      expect.objectContaining({ id: original.id, kind: "loss", reversed: true, wetDeltaKg: -LOSS_KG,
        beforeWetKg: INITIAL_KG, afterWetKg: INITIAL_KG,
        reversedBy: { id: reversal.id, reason: REASON, recordedAt: reversal.createdAt.toISOString(),
          actorName: ACTOR_NAME, replacementId: replacement.id } }),
      expect.objectContaining({ id: replacement.id, kind: "loss", correctsMovementId: original.id,
        occurredAt: EDIT_AT, wetDeltaKg: -REPLACEMENT_KG, beforeWetKg: INITIAL_KG,
        afterWetKg: AFTER_EDIT_KG, estimatedDryKg: AFTER_EDIT_KG, editLockedReason: null }),
    ]);
    expect(stock.entries.some(entry => entry.id === reversal.id)).toBe(false);
    expect(stock.batches).toEqual([expect.objectContaining({ id: f.intake.id, wetKg: AFTER_EDIT_KG, dryKg: AFTER_EDIT_KG })]);
    expect(stock.entries.find(entry => entry.kind === "intake")).not.toHaveProperty("editLockedReason");
  });

  it("removes 120 kg of Lost mass and restores exactly 1000 kg", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const reversal = saved<BinMovement>(await removeLossFn(removeInput(f, original.id)));
    expect(reversal).toMatchObject({ movementType: "adjustment", correctsMovementId: original.id,
      massDeltaKg: LOSS_KG, occurredAt: original.occurredAt, outputKind: null });
    expect(await rows(f)).toHaveLength(REMOVAL_ROWS);
    const stock = await ledger(f);
    expect(stock.currentWetKg).toBe(INITIAL_KG);
    expect(stock.entries).toEqual([
      expect.objectContaining({ id: f.intake.id, beforeWetKg: 0, afterWetKg: INITIAL_KG }),
      expect.objectContaining({ id: original.id, reversed: true, beforeWetKg: INITIAL_KG, afterWetKg: INITIAL_KG,
        reversedBy: { id: reversal.id, reason: REASON, recordedAt: reversal.createdAt.toISOString(),
          actorName: ACTOR_NAME, replacementId: null } }),
    ]);
    expect(stock.batches).toEqual([expect.objectContaining({ id: f.intake.id, wetKg: INITIAL_KG, dryKg: INITIAL_KG })]);
  });

  it("allows a larger replacement when the stock can cover it", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    saved(await recordLossFn({ ...editInput(f, original.id), lossMassKg: LARGER_LOSS_KG }));
    expect((await ledger(f)).currentWetKg).toBe(AFTER_LARGER_EDIT_KG);
    expect((await rows(f)).filter(row => row.movementType === "adjustment")).toEqual([
      expect.objectContaining({ massDeltaKg: LOSS_KG, correctsMovementId: original.id }),
    ]);
  });

  it("restores a fractional loss exactly without rounding it into a top-up", async () => {
    const f = await seedBin();
    const original = saved(await recordLossFn(lossInput(f, { lossMassKg: FRACTIONAL_LOSS_KG })));
    const reversal = saved<BinMovement>(await removeLossFn(removeInput(f, original.id)));
    expect((await rows(f)).find(row => row.id === reversal.id)).toMatchObject({
      correctsMovementId: original.id, massDeltaKg: FRACTIONAL_LOSS_KG,
    });
    expect((await ledger(f)).currentWetKg).toBe(INITIAL_KG);
  });

  it.each(["edit", "remove"] as const)("refuses another correction of an original after %s", async (command) => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    if (command === "edit") saved(await recordLossFn(editInput(f, original.id)));
    else saved<BinMovement>(await removeLossFn(removeInput(f, original.id)));
    await expectBothCorrectionsRefused(f, original.id);
    const again = await removeLossFn(removeInput(f, original.id));
    expect(again).toMatchObject({ success: false, error: expect.stringMatching(/already.*corrected/i) });
  });

  it("allows the replacement to be corrected without restoring the original twice", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const replacement = saved(await recordLossFn(editInput(f, original.id)));
    saved<BinMovement>(await removeLossFn(removeInput(f, replacement.id)));
    const stock = await ledger(f);
    expect(stock.currentWetKg).toBe(INITIAL_KG);
    expect(stock.entries.find(entry => entry.id === replacement.id)).toMatchObject({
      reversed: true, reversedBy: { replacementId: null },
    });
    await expectBothCorrectionsRefused(f, original.id);
  });

  it.each([true, false])("refuses an adjustment as a correction target (count snapshot: %s)", async (hasCount) => {
    const f = await seedBin();
    const [count] = await db.insert(binMovements).values({ organizationId: f.ctx.organizationId,
      storageLocationId: f.bin.id, lane: "feedstock", movementType: "adjustment", massDeltaKg: -LOSS_KG,
      countedMassKg: hasCount ? AFTER_LOSS_KG : null, countedWetMassKg: hasCount ? AFTER_LOSS_KG : null,
      moistureRatioUsed: hasCount ? 0 : null,
      createdAt: new Date(LOSS_AT), reason: "Physical stock count", createdBy: f.ctx.userId,
    }).returning();
    await expectBothCorrectionsRefused(f, count.id);
  });

  it("refuses a reversal as a correction target", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const reversal = saved<BinMovement>(await removeLossFn(removeInput(f, original.id)));
    await expectBothCorrectionsRefused(f, reversal.id);
  });

  it("refuses an output-lane loss even when its biochar bin is named", async () => {
    const f = await seedBin();
    const [bin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId,
      facilityId: f.facility.id, code: `E2E-OUT-${f.tag}`, name: "E2E Biochar bin", type: "biochar_bin",
    }).returning();
    const [outputLoss] = await db.insert(binMovements).values({ organizationId: f.ctx.organizationId,
      storageLocationId: bin.id, lane: "biochar", movementType: "loss", massDeltaKg: -LOSS_KG,
      outputKind: "loss", occurredAt: new Date(LOSS_AT), reason: "Spillage", createdBy: f.ctx.userId,
      idempotencyKey: randomUUID(), basisFingerprint: "fixture", inputSnapshot: {},
      outputDryDeltaKg: String(-LOSS_KG), balanceBeforeDryKg: String(INITIAL_KG), balanceAfterDryKg: String(AFTER_LOSS_KG),
    }).returning();
    const outputFixture = { ...f, bin };
    expect(await recordLossFn({ ...editInput(outputFixture, outputLoss.id), lane: "biochar" }))
      .toMatchObject({ success: false });
    expect(await removeLossFn(removeInput(outputFixture, outputLoss.id))).toMatchObject({ success: false });
    expect(await rows(outputFixture)).toEqual([outputLoss]);
    expect((await ledger(f)).currentWetKg).toBe(INITIAL_KG);
  });

  it("refuses a loss from another bin in the same organization", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const bin = await seedSiblingBin(f);
    await expectBothCorrectionsRefused({ ...f, bin }, original.id);
    expect(await rows(f)).toEqual([original]);
    expect((await ledger(f)).currentWetKg).toBe(AFTER_LOSS_KG);
  });

  it("refuses a loss from another organization", async () => {
    const foreign = await seedBin();
    const original = await recordOriginal(foreign);
    const caller = await seedBin();
    await expectBothCorrectionsRefused(caller, original.id);
    // Even supplying both foreign identifiers must not grant access.
    expect(await recordLossFn(editInput(foreign, original.id))).toMatchObject({ success: false });
    expect(await removeLossFn(removeInput(foreign, original.id))).toMatchObject({ success: false });
    expect(await rows(foreign)).toEqual([original]);
  });

  it("locks both commands on a later production run and exposes the same reason in the ledger", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const run = await seedRunDraw(f, LATER_AT);
    const before = await ledger(f);
    for (const result of [await recordLossFn(editInput(f, original.id)), await removeLossFn(removeInput(f, original.id))]) {
      expect(result).toMatchObject({ success: false, code: "certification_locked",
        error: expect.stringMatching(/^Correction blocked by a later production run/),
        conflict: { entity: "storageLocation", id: f.bin.id, code: f.bin.code },
        blockers: [expect.objectContaining({ entity: "productionRun", id: run.id, code: expect.any(String) })],
      });
      if (result.success) throw new Error("Expected the later production run to block correction");
      expect(before.entries.find(entry => entry.id === original.id)).toMatchObject({ editLockedReason: result.error });
    }
    expect(await rows(f)).toHaveLength(ORIGINAL_ROWS);
    expect(await ledger(f)).toEqual(before);
  });

  it("does not lock a loss on an earlier production run draw", async () => {
    const f = await seedBin();
    await seedRunDraw(f, BEFORE_LOSS_AT);
    const original = await recordOriginal(f);
    expect((await ledger(f)).entries.find(entry => entry.id === original.id)).toMatchObject({ editLockedReason: null });
    saved(await recordLossFn(editInput(f, original.id)));
    expect((await ledger(f)).currentWetKg).toBe(AFTER_DRAW_EDIT_KG);
  });

  it("refuses moving a loss before an earlier production run draw without writing", async () => {
    const f = await seedBin();
    const run = await seedRunDraw(f, BEFORE_LOSS_AT);
    const original = await recordOriginal(f);
    const before = await ledger(f);
    const input = editInput(f, original.id);
    const message = `Lost mass was not changed. The new time is before the production run ${run.code}` +
      ` (${formatFacilityDateTime(BEFORE_LOSS_AT, f.facility.timezone)}).` +
      " Choose a time after it, or delete this entry and record a new loss.";
    expect(await recordLossFn({ ...input, occurredAt: BEFORE_DRAW_AT })).toMatchObject({
      success: false, code: "validation_failed", error: message,
      issues: [{ path: ["occurredAt"], code: "validation_failed", message }],
    });
    expect(await rows(f)).toEqual([original]);
    expect(await ledger(f)).toEqual(before);
    // The refused request leaves its key available for a valid retry.
    saved(await recordLossFn({ ...input, occurredAt: BETWEEN_DRAW_AND_LOSS_AT }));
    expect(await rows(f)).toHaveLength(EDIT_ROWS);
    expect((await ledger(f)).currentWetKg).toBe(AFTER_DRAW_EDIT_KG);
  });

  it.each([BETWEEN_DRAW_AND_LOSS_AT, BEFORE_LOSS_AT, LOSS_AT])(
    "allows a replacement at %s without crossing an earlier draw", async (occurredAt) => {
      const f = await seedBin();
      await seedRunDraw(f, BEFORE_LOSS_AT);
      const original = await recordOriginal(f);
      const replacement = saved(await recordLossFn({ ...editInput(f, original.id), occurredAt }));
      expect(replacement.occurredAt).toEqual(new Date(occurredAt));
      const stored = await rows(f);
      expect(stored).toHaveLength(EDIT_ROWS);
      expect(stored.find(row => row.movementType === "adjustment")).toMatchObject({
        correctsMovementId: original.id, occurredAt: original.occurredAt,
      });
      expect((await ledger(f)).currentWetKg).toBe(AFTER_DRAW_EDIT_KG);
    },
  );

  it("does not lock a loss on a later intake", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      organizationId: f.ctx.organizationId, facilityId: f.facility.id, feedstockTypeId: f.feedstockType.id,
      storageLocationId: f.bin.id, code: `E2E-LATER-${f.tag}`, status: "complete", massWetKg: INITIAL_KG,
      massDryKg: INITIAL_KG, moistureContentPercent: 0, deliveryDate: new Date(LATER_INTAKE_AT),
    }));
    expect((await ledger(f)).entries.find(entry => entry.id === original.id)).toMatchObject({ editLockedReason: null });
    saved(await recordLossFn(editInput(f, original.id)));
    expect((await ledger(f)).currentWetKg).toBe(AFTER_LATER_INTAKE_EDIT_KG);
  });

  it("locks on a later live loss and unlocks when that later loss is removed", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const later = saved(await recordLossFn(lossInput(f, { occurredAt: LATER_AT, lossMassKg: LATER_LOSS_KG })));
    const before = await ledger(f);
    expect(before.currentWetKg).toBe(AFTER_TWO_LOSSES_KG);
    const blocked = await recordLossFn(editInput(f, original.id));
    expect(blocked).toMatchObject({ success: false, code: "certification_locked",
      error: expect.stringMatching(/^Correction blocked by a later lost mass/),
      conflict: { entity: "storageLocation", id: f.bin.id },
      blockers: [expect.objectContaining({ entity: "binMovement", id: later.id })],
    });
    if (blocked.success) throw new Error("Expected the later Lost mass entry to lock the earlier one");
    expect(before.entries.find(entry => entry.id === original.id)).toMatchObject({ editLockedReason: blocked.error });
    expect(before.entries.find(entry => entry.id === later.id)).toMatchObject({ editLockedReason: null });
    saved<BinMovement>(await removeLossFn(removeInput(f, later.id)));
    const unlocked = await ledger(f);
    expect(unlocked.currentWetKg).toBe(AFTER_LOSS_KG);
    expect(unlocked.entries.find(entry => entry.id === original.id)).toMatchObject({ editLockedReason: null });
    saved(await recordLossFn(editInput(f, original.id)));
    expect((await ledger(f)).currentWetKg).toBe(AFTER_EDIT_KG);
  });

  it("replays an edit without writing and conflicts when any saved value changes", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const input = editInput(f, original.id);
    const first = saved(await recordLossFn(input));
    const replay = saved(await recordLossFn(input));
    expect(replay.id).toBe(first.id);
    const otherBin = await seedSiblingBin(f);
    for (const changed of [
      { lossMassKg: LARGER_LOSS_KG }, { occurredAt: LATER_AT }, { reason: "Different correction" },
      { correctsMovementId: randomUUID() }, { storageLocationId: otherBin.id },
    ]) {
      expect(await recordLossFn({ ...input, ...changed })).toMatchObject({ success: false, code: "conflict",
        conflict: { entity: "storageLocation", id: "storageLocationId" in changed ? changed.storageLocationId : f.bin.id } });
    }
    const stored = await rows(f);
    expect(stored).toHaveLength(EDIT_ROWS);
    expect(stored.filter(row => row.correctsMovementId === original.id && row.movementType === "adjustment")).toHaveLength(SINGLE_ROW);
    expect(stored.filter(row => row.correctsMovementId === original.id && row.movementType === "loss")).toHaveLength(SINGLE_ROW);
    expect((await ledger(f)).currentWetKg).toBe(AFTER_EDIT_KG);
  });

  it("posts one correction when identical edits race", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const input = editInput(f, original.id);
    const [left, right] = await Promise.all([recordLossFn(input), recordLossFn(input)]);
    expect(saved(right).id).toBe(saved(left).id);
    const stored = await rows(f);
    expect(stored).toHaveLength(EDIT_ROWS);
    expect(stored.filter(row => row.movementType === "adjustment")).toHaveLength(SINGLE_ROW);
    expect(stored.filter(row => row.correctsMovementId === original.id && row.movementType === "loss")).toHaveLength(SINGLE_ROW);
    expect((await ledger(f)).currentWetKg).toBe(AFTER_EDIT_KG);
  });

  it("replays removal and conflicts when the same key carries changed values", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const input = removeInput(f, original.id);
    const first = saved<BinMovement>(await removeLossFn(input));
    expect(saved<BinMovement>(await removeLossFn(input)).id).toBe(first.id);
    const otherBin = await seedSiblingBin(f);
    for (const changed of [
      { reason: "Different correction" }, { correctsMovementId: randomUUID() }, { storageLocationId: otherBin.id },
    ]) {
      expect(await removeLossFn({ ...input, ...changed })).toMatchObject({ success: false, code: "conflict",
        conflict: { entity: "storageLocation", id: "storageLocationId" in changed ? changed.storageLocationId : f.bin.id } });
    }
    expect(await rows(f)).toHaveLength(REMOVAL_ROWS);
    expect((await ledger(f)).currentWetKg).toBe(INITIAL_KG);
  });

  it("posts one reversal when identical removals race", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const input = removeInput(f, original.id);
    const [left, right] = await Promise.all([removeLossFn(input), removeLossFn(input)]);
    expect(saved<BinMovement>(right).id).toBe(saved<BinMovement>(left).id);
    const stored = await rows(f);
    expect(stored).toHaveLength(REMOVAL_ROWS);
    expect(stored.filter(row => row.correctsMovementId === original.id)).toEqual([
      expect.objectContaining({ movementType: "adjustment", massDeltaKg: LOSS_KG }),
    ]);
    expect((await ledger(f)).currentWetKg).toBe(INITIAL_KG);
  });

  it.each([
    { label: "larger than available stock", override: { lossMassKg: OVERDRAW_KG } },
    { label: "earlier than the intake", override: { occurredAt: BEFORE_INTAKE_AT } },
  ])("rolls back a replacement $label", async ({ override }) => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const before = await ledger(f);
    const input = editInput(f, original.id);
    const result = await recordLossFn({ ...input, ...override });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected insufficient feedstock to refuse the correction");
    if (result.field === "lossMassKg") {
      expect(result.error).toMatch(/stock|available|exceed|enough/i);
    } else {
      expect(result).toMatchObject({ code: "validation_failed", issues: expect.arrayContaining([
        expect.objectContaining({ path: ["occurredAt"] }),
      ]) });
    }
    expect(await rows(f)).toEqual([original]);
    expect(await ledger(f)).toEqual(before);
    // Rollback must also leave the form key available for a valid retry.
    saved(await recordLossFn(input));
    expect((await ledger(f)).currentWetKg).toBe(AFTER_EDIT_KG);
  });

  it("refuses a future replacement time without writing", async () => {
    const f = await seedBin();
    const original = await recordOriginal(f);
    const before = await ledger(f);
    const result = await recordLossFn({ ...editInput(f, original.id), occurredAt: new Date(Date.now() + FUTURE_OFFSET_MS).toISOString() });
    expect(result).toMatchObject({ success: false, code: "validation_failed",
      error: expect.stringContaining("Date and time cannot be in the future."),
      issues: expect.arrayContaining([expect.objectContaining({ path: ["occurredAt"] })]),
    });
    expect(await rows(f)).toEqual([original]);
    expect(await ledger(f)).toEqual(before);
  });
});
