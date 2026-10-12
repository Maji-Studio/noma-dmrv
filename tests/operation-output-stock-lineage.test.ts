/**
 * Decision 51: every layer whose moisture reading a movement changes passes
 * the certification-lineage guard, not only the layers it draws from. The
 * biochar bin holds R1 (900 kg dry, placed 2026-09-09) and R2 (600 kg dry,
 * placed 2026-09-11); R2 belongs to a Removal. Counts that never draw from R2
 * but reset its reading, and a correction that removes R2's original reading,
 * are refused with `certification_locked`. Without a submitted artifact the
 * same lineage is open and the same movements save.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applications, binMovements, certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatchProductionRuns,
  creditBatches, deliveries, feedstocks, productionProcesses,
} from "@/db/schema";
import { createOrder } from "@/data-access/orders";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { recordOutputStockMovement } from "@/lib/operations/output-stock";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";

type Fixture = Awaited<ReturnType<typeof seedOutputStockParents>>;

const STOCK_TIME = "2026-09-14T12:00:00.000Z";
/** After R1 is placed and before R2 is: a count then sees R1 alone. */
const BEFORE_R2 = "2026-09-10T12:00:00.000Z";
const COUNT_MOISTURE = 20;
/** 1875 kg at 20% is exactly the bin's 1500 kg of solids: no draw, readings on R1 and R2. */
const EVEN_COUNT_WET_KG = 1875;
/** 1250 kg at 20% is 1000 kg of solids: 500 kg drawn from R1, readings on R1 and R2. */
const PARTIAL_COUNT_WET_KG = 1250;
/** 1125 kg at 20% is R1's 900 kg of solids. */
const R1_COUNT_WET_KG = 1125;
const DELIVERED_KG = 100;
const APPLIED_TONNES = 0.1;
const FIELD_SIZE_HA = 1;
const FIELD_LATITUDE = -3.3349;
const FIELD_LONGITUDE = 37.3404;
const LOCKED_COPY = "is locked by a certification submission.";

const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    const organizationId = f.ctx.organizationId;
    await db.transaction(async (tx) => {
      for (const table of ["certification_submissions", "credit_batch_applications", "credit_batch_production_runs", "credit_batches", "certifier_removals", "production_processes"]) {
        await tx.execute(sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`);
      }
    });
    await cleanupOutputStockFixture(db, organizationId);
  }
});

async function fixture(): Promise<Fixture> {
  const f = await seedOutputStockParents(db);
  fixtures.push(f);
  return f;
}

/**
 * Puts R2 in a credit batch whose applied slice belongs to a Removal, the
 * lineage `assertCanMutateCertifiedLineage` follows. `submitted` adds the
 * Isometric submission that locks it.
 */
async function certifyR2(f: Fixture, submitted: boolean) {
  const organizationId = f.ctx.organizationId;
  const [intake] = await db.select({ feedstockTypeId: feedstocks.feedstockTypeId }).from(feedstocks).where(eq(feedstocks.organizationId, organizationId));
  const order = await createOrder(f.ctx, { code: `E2E-OSL-O-${f.tag}`, facilityId: f.facility.id, customerId: f.customer.id,
    formulationId: f.pure.id, orderDate: new Date(STOCK_TIME), quantityKg: DELIVERED_KG, packaging: "loose" });
  const [delivery] = await db.insert(deliveries).values({ organizationId, code: `E2E-OSL-D-${f.tag}`, facilityId: f.facility.id, orderId: order.id,
    storageLocationId: f.bin.id, deliveryDate: new Date(STOCK_TIME), status: "delivered", deliveredWetMassKg: DELIVERED_KG, massDryKg: DELIVERED_KG }).returning();
  const [application] = await db.insert(applications).values({ organizationId, code: `E2E-OSL-A-${f.tag}`, deliveryId: delivery.id,
    applicationDate: new Date(STOCK_TIME), biocharAppliedTons: APPLIED_TONNES, biocharAppliedDryTons: APPLIED_TONNES,
    fieldSizeHa: FIELD_SIZE_HA, gpsLatitude: FIELD_LATITUDE, gpsLongitude: FIELD_LONGITUDE }).returning();
  const [process] = await db.insert(productionProcesses).values({ organizationId, facilityId: f.facility.id, feedstockTypeId: intake.feedstockTypeId }).returning();
  const [batch] = await db.insert(creditBatches).values({ organizationId, code: `E2E-OSL-CB-${f.tag}`, facilityId: f.facility.id, feedstockTypeId: intake.feedstockTypeId,
    productionProcessId: process.id, status: "pending", startDate: "2026-09-01", endDate: "2026-09-30", certifier: "isometric" }).returning();
  const [removal] = await db.insert(certifierRemovals).values({ organizationId, facilityId: f.facility.id }).returning();
  await db.insert(creditBatchProductionRuns).values({ organizationId, creditBatchId: batch.id, productionRunId: f.runs[1].id });
  await db.insert(creditBatchApplications).values({ organizationId, creditBatchId: batch.id, applicationId: application.id,
    allocatedWetMassKg: DELIVERED_KG, allocatedDryMassKg: DELIVERED_KG, removalId: removal.id });
  if (submitted) {
    await db.insert(certificationSubmissions).values({ organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal",
      localEntityId: removal.id, externalId: `ext_osl_${f.tag}`, version: 1, status: "submitted", payloadHash: `hash-${f.tag}`,
      payloadSnapshot: { fixture: "operation-output-stock-lineage" }, submittedAt: new Date(STOCK_TIME) });
  }
}

const count = (f: Fixture, wetMassKg: number, changes: Record<string, unknown> = {}) => ({
  storageLocationId: f.source.id, kind: "count", occurredAt: STOCK_TIME, wetMassKg, moisturePercent: COUNT_MOISTURE, reason: "E2E stock take", ...changes,
});
const movementCount = async (f: Fixture) => (await db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId))).length;
const locked = { code: "certification_locked", message: expect.stringContaining(LOCKED_COPY) };

/** A count posted while R2 was open, then R2 certified, then the form's correction of it. */
async function correctableCount(f: Fixture) {
  const original = await runOperation(recordOutputStockMovement, f.ctx, count(f, EVEN_COUNT_WET_KG));
  await certifyR2(f, true);
  return original.data.movementId;
}
async function formCorrection(f: Fixture, correctsMovementId: string, changes: { occurredAt: string; wetMassKg: number }) {
  const input = { storageLocationId: f.source.id, facilityId: f.facility.id, kind: "count" as const, moisturePercent: COUNT_MOISTURE, correctsMovementId, ...changes };
  const preview = await previewOutputStock(f.ctx, input);
  return { preview, post: () => runOperationInProcess(recordOutputStockMovement, f.ctx, { ...input, expectedProductVersions: preview.expectedProductVersions,
    basisFingerprint: preview.basisFingerprint, idempotencyKey: randomUUID(), reason: "E2E correction" }) };
}

describe("counts on a bin holding certified runs", () => {
  it("refuses a zero-draw count that only resets a certified run's reading", async () => {
    const f = await fixture();
    await certifyR2(f, true);
    await expect(runOperation(recordOutputStockMovement, f.ctx, count(f, EVEN_COUNT_WET_KG))).rejects.toMatchObject(locked);
    expect(await movementCount(f)).toBe(0);
  });

  it("refuses a partial count that draws only from an open run but resets a certified one", async () => {
    const f = await fixture();
    await certifyR2(f, true);
    await expect(runOperation(recordOutputStockMovement, f.ctx, count(f, PARTIAL_COUNT_WET_KG))).rejects.toMatchObject(locked);
    await expect(runOperation(recordOutputStockMovement, f.ctx, count(f, PARTIAL_COUNT_WET_KG), { dryRun: true })).rejects.toMatchObject(locked);
    expect(await movementCount(f)).toBe(0);
  });

  it("allows a count timed before the certified run reached the bin", async () => {
    const f = await fixture();
    await certifyR2(f, true);
    await runOperation(recordOutputStockMovement, f.ctx, count(f, R1_COUNT_WET_KG, { occurredAt: BEFORE_R2 }));
    expect(await movementCount(f)).toBe(1);
  });

  it("saves the same counts while the lineage has no submitted artifact", async () => {
    const f = await fixture();
    await certifyR2(f, false);
    await runOperation(recordOutputStockMovement, f.ctx, count(f, EVEN_COUNT_WET_KG));
    await runOperation(recordOutputStockMovement, f.ctx, count(f, PARTIAL_COUNT_WET_KG));
    expect(await movementCount(f)).toBe(2);
  });
});

describe("form corrections on a bin holding certified runs", () => {
  it("refuses a correction whose replacement resets the certified run's reading, and the preview names the blocker", async () => {
    const f = await fixture();
    const original = await correctableCount(f);
    const before = await movementCount(f);
    const { preview, post } = await formCorrection(f, original, { occurredAt: STOCK_TIME, wetMassKg: EVEN_COUNT_WET_KG - COUNT_MOISTURE });
    expect(preview.blockingMessage).toContain("certification");
    await expect(post()).rejects.toMatchObject(locked);
    expect(await movementCount(f)).toBe(before);
  });

  it("refuses a backdated correction that only removes the certified run's original reading", async () => {
    const f = await fixture();
    const original = await correctableCount(f);
    const before = await movementCount(f);
    // At this time the bin held R1 alone, so the replacement records no reading for R2.
    const { post } = await formCorrection(f, original, { occurredAt: BEFORE_R2, wetMassKg: R1_COUNT_WET_KG });
    await expect(post()).rejects.toMatchObject(locked);
    expect(await movementCount(f)).toBe(before);
  });
});
