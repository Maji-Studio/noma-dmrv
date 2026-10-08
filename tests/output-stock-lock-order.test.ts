import { masterDataVersion } from "./helpers/master-data-version";
/** PostgreSQL regressions. Written for the DB runner; never uses timing sleeps. */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db, type DbTransaction } from "@/db";
import { biocharProducts, deliveries, outputStockAllocations, applicationOutputAllocations, certifierRemovals, creditBatchApplications, creditBatchProductionRuns, creditBatches, productionProcesses } from "@/db/schema";
import { deleteBiocharProduct, updateBiocharProduct } from "@/data-access/biochar-products";
import { createApplication } from "@/data-access/applications";
import { getLockedCertifiedLineage } from "@/data-access/certification-lineage-guards";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { withOutputStockPosting } from "@/data-access/output-stock-post";
import { insertOutputApplicationFixture } from "./helpers/output-contract-fixtures";
import { cleanupPostedStock, postedStockFixture, postDelivery, postProduct, STOCK_TIME } from "./helpers/posted-output-stock-fixture";

const BARRIER_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 15_000;
const LOSS_KG = 10;
const KG_PER_TON = 1000;
const STOCK_KG_PER_PRODUCT = 100;
const EXPECTED_FINAL_VERSION = 3;
type Fixture = Awaited<ReturnType<typeof postedStockFixture>>;

function gate() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function outcome<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
async function backendPid(tx: DbTransaction) {
  const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
  return result.rows[0].pid;
}
async function blockedQuery(pid: number) {
  const result = await db.execute<{ query: string }>(sql`
    select query from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
  `);
  return result.rows[0]?.query ?? "";
}
async function lossCommand(f: Fixture) {
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME,
    kind: "loss" as const, wetMassKg: LOSS_KG, moisturePercent: 0 };
  const preview = await previewOutputStock(f.ctx, input);
  return { ...input, expectedProductVersions: preview.expectedProductVersions, basisFingerprint: preview.basisFingerprint,
    idempotencyKey: randomUUID(), reason: "E2E lock ordering" };
}
async function lockProduct(tx: DbTransaction, f: Fixture, id: string, noWait = false) {
  await tx.select({ id: biocharProducts.id }).from(biocharProducts)
    .where(and(eq(biocharProducts.organizationId, f.ctx.organizationId), eq(biocharProducts.id, id)))
    .for("update", noWait ? { noWait: true } : undefined);
}

/** A real unsubmitted lineage so both delete and loss request the same artifact lock. */
async function addRemoval(f: Fixture, deliveryKg = LOSS_KG) {
  const delivery = await postDelivery(f, deliveryKg);
  const organizationId = f.ctx.organizationId;
  const [application] = await insertOutputApplicationFixture(db, {
    organizationId, code: `E2E-LOCK-AP-${f.tag}`, deliveryId: delivery.id,
    applicationDate: new Date(STOCK_TIME), biocharAppliedTons: 0.01, biocharAppliedDryTons: 0.01,
    fieldSizeHa: 1, gpsLatitude: -3, gpsLongitude: 37,
  }, row => row, true);
  const [process] = await db.insert(productionProcesses).values({ organizationId, facilityId: f.facility.id, feedstockTypeId: f.ingredientType.id }).returning();
  const [batch] = await db.insert(creditBatches).values({ organizationId, code: `E2E-LOCK-CB-${f.tag}`,
    facilityId: f.facility.id, feedstockTypeId: f.ingredientType.id, productionProcessId: process.id,
    startDate: "2026-09-01", endDate: "2026-09-30", certifier: "isometric" }).returning();
  const [removal] = await db.insert(certifierRemovals).values({ organizationId, facilityId: f.facility.id }).returning();
  await db.insert(creditBatchProductionRuns).values({ organizationId, creditBatchId: batch.id, productionRunId: f.runs[0].id });
  await db.insert(creditBatchApplications).values({ organizationId, creditBatchId: batch.id, applicationId: application.id,
    removalId: removal.id, allocatedWetMassKg: LOSS_KG, allocatedDryMassKg: LOSS_KG });
  return delivery;
}
async function cleanup(f: Fixture) {
  await db.delete(creditBatchApplications).where(eq(creditBatchApplications.organizationId, f.ctx.organizationId));
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, f.ctx.organizationId));
  await db.delete(creditBatches).where(eq(creditBatches.organizationId, f.ctx.organizationId));
  await db.delete(certifierRemovals).where(eq(certifierRemovals.organizationId, f.ctx.organizationId));
  await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, f.ctx.organizationId));
  await cleanupPostedStock(f);
}

it("product deletion waits for stock's bin before taking the product row or artifact", async () => {
  const f = await postedStockFixture();
  const resume = gate();
  let posting: ReturnType<typeof outcome> | undefined;
  let deleting: ReturnType<typeof outcome> | undefined;
  let pid = 0;
  try {
    await addRemoval(f);
    const input = await lossCommand(f);
    posting = outcome(withOutputStockPosting(f.ctx, {
      input, locksTransportRoutes: true,
      replay: async () => { throw new Error("Unexpected replay"); },
      write: async (tx, post) => {
        const lineage = await getLockedCertifiedLineage(f.ctx, tx, { entityType: "biocharProduct", entityId: f.product!.id });
        expect(lineage.length).toBeGreaterThan(0);
        expect(lineage.every(row => row.removalSubmissionId === null && row.ghgStatementSubmissionId === null)).toBe(true);
        pid = await backendPid(tx);
        await resume.promise;
        // Old delete owns this row while waiting for our artifact: fail immediately.
        await lockProduct(tx, f, f.product!.id, true);
        return post();
      },
    }));
    await expect.poll(() => pid, { timeout: BARRIER_TIMEOUT_MS }).not.toBe(0);
    deleting = outcome(deleteBiocharProduct(f.ctx, f.product!.id, input.expectedProductVersions[f.product!.id]));
    await expect.poll(() => blockedQuery(pid), { timeout: BARRIER_TIMEOUT_MS }).toContain("pg_advisory_xact_lock");
    resume.release();
    expect(await posting).toMatchObject({ ok: true });
    // Posting wins; delete must observe its new version immediately after locking.
    expect(await deleting).toMatchObject({ ok: false, error: { code: "stale_version" } });
  } finally {
    resume.release();
    await Promise.all([posting, deleting]);
    await cleanup(f);
  }
}, TEST_TIMEOUT_MS);

it.each(["archive", "restore"] as const)("facility %s locks products in posting order before cascading", async operation => {
  const f = await postedStockFixture({ stockKg: STOCK_KG_PER_PRODUCT });
  const resume = gate();
  let writer: ReturnType<typeof outcome> | undefined;
  let cascade: ReturnType<typeof outcome> | undefined;
  let pid = 0;
  try {
    const second = await postProduct(f, { massKg: STOCK_KG_PER_PRODUCT });
    const ids = [f.product!.id, second.id].sort();
    const input = await lossCommand(f);
    const holdPrefix = async (tx: DbTransaction) => {
      await lockProduct(tx, f, ids[0]);
      pid = await backendPid(tx);
      await resume.promise;
      // The cascade must not have locked a later UUID before waiting for us.
      await lockProduct(tx, f, ids[1], true);
    };
    if (operation === "archive") {
      // A no-loss count reads and version-bumps both products.
      const count = { ...input, kind: "count" as const, wetMassKg: STOCK_KG_PER_PRODUCT * ids.length };
      const preview = await previewOutputStock(f.ctx, count);
      writer = outcome(withOutputStockPosting(f.ctx, {
        input: { ...count, basisFingerprint: preview.basisFingerprint, expectedProductVersions: preview.expectedProductVersions },
        locksTransportRoutes: true,
        replay: async () => { throw new Error("Unexpected replay"); },
        write: async (tx, post) => { await holdPrefix(tx); return post(); },
      }));
    } else {
      await archiveFacility(f.ctx, f.facility.id, await masterDataVersion(f.ctx, "facilities", f.facility.id));
      // Archived bins correctly reject posting; reproduce its row-lock prefix
      // directly to test restore's matching order without bypassing that guard.
      writer = outcome(db.transaction(holdPrefix));
    }
    await expect.poll(() => pid, { timeout: BARRIER_TIMEOUT_MS }).not.toBe(0);
    cascade = outcome(operation === "archive" ? archiveFacility(f.ctx, f.facility.id, await masterDataVersion(f.ctx, "facilities", f.facility.id)) : restoreFacility(f.ctx, f.facility.id, await masterDataVersion(f.ctx, "facilities", f.facility.id)));
    // This also fails on the old bulk UPDATE even if its scan happens to visit
    // the lower UUID first. The ordering must be guaranteed, never incidental.
    await expect.poll(() => blockedQuery(pid), { timeout: BARRIER_TIMEOUT_MS }).toMatch(/order by .*"biochar_products"\."id".*for no key update/i);
    resume.release();
    expect(await writer).toMatchObject({ ok: true });
    expect(await cascade).toMatchObject({ ok: true });
    const rows = await db.select().from(biocharProducts).where(eq(biocharProducts.organizationId, f.ctx.organizationId));
    expect(rows).toHaveLength(ids.length);
    for (const row of rows) {
      expect(row.archivedAt === null).toBe(operation === "restore");
      expect(row.version).toBe(EXPECTED_FINAL_VERSION); // posting + archive, or archive + restore
    }
  } finally {
    resume.release();
    await Promise.all([writer, cascade]);
    await cleanup(f);
  }
}, TEST_TIMEOUT_MS);

it.each(["archive", "restore"] as const)("delivery correction precedes facility %s product locks", async operation => {
  const f = await postedStockFixture();
  const resume = gate();
  let writer: ReturnType<typeof outcome> | undefined;
  let cascade: ReturnType<typeof outcome> | undefined;
  let pid = 0;
  try {
    const delivery = await postDelivery(f, LOSS_KG);
    const [allocation] = await db.select().from(outputStockAllocations).where(and(
      eq(outputStockAllocations.organizationId, f.ctx.organizationId),
      eq(outputStockAllocations.deliveryId, delivery.id),
    ));
    const correction = { facilityId: f.facility.id, storageLocationId: f.bin.id,
      occurredAt: STOCK_TIME, kind: "delivery" as const, wetMassKg: LOSS_KG,
      moisturePercent: 0, correctsMovementId: allocation.movementId };
    const preview = await previewOutputStock(f.ctx, correction);
    const holdDelivery = async (tx: DbTransaction) => {
      await tx.select({ id: deliveries.id }).from(deliveries).where(and(
        eq(deliveries.organizationId, f.ctx.organizationId), eq(deliveries.id, delivery.id),
      )).for("update");
      pid = await backendPid(tx);
      await resume.promise;
      // Old cascade owns this product while waiting for our delivery.
      await lockProduct(tx, f, f.product!.id, true);
    };
    if (operation === "archive") {
      writer = outcome(withOutputStockPosting(f.ctx, {
        input: { ...correction, expectedProductVersions: preview.expectedProductVersions,
          basisFingerprint: preview.basisFingerprint, idempotencyKey: randomUUID(), reason: "E2E delivery correction lock order" },
        locksTransportRoutes: true,
        replay: async () => { throw new Error("Unexpected replay"); },
        write: async (tx, post) => { await holdDelivery(tx); return post(); },
      }));
    } else {
      await archiveFacility(f.ctx, f.facility.id, await masterDataVersion(f.ctx, "facilities", f.facility.id));
      // Archived bins reject posting; exercise its delivery/product prefix directly.
      writer = outcome(db.transaction(holdDelivery));
    }
    await expect.poll(() => pid, { timeout: BARRIER_TIMEOUT_MS }).not.toBe(0);
    const version = await masterDataVersion(f.ctx, "facilities", f.facility.id);
    cascade = outcome(operation === "archive"
      ? archiveFacility(f.ctx, f.facility.id, version)
      : restoreFacility(f.ctx, f.facility.id, version));
    // Wait for either implementation to block, then use NOWAIT to detect inversion.
    await expect.poll(() => blockedQuery(pid), { timeout: BARRIER_TIMEOUT_MS }).toContain('"deliveries"');
    resume.release();
    expect(await writer).toMatchObject({ ok: true });
    expect(await cascade).toMatchObject({ ok: true });
  } finally {
    resume.release();
    await Promise.all([writer, cascade]);
    await cleanup(f);
  }
}, TEST_TIMEOUT_MS);

it("application creation holds artifacts before product edits can lock the product", async () => {
  const f = await postedStockFixture({ stockKg: STOCK_KG_PER_PRODUCT });
  const resume = gate();
  let creating: ReturnType<typeof outcome> | undefined;
  let editing: ReturnType<typeof outcome> | undefined;
  let pid = 0;
  let transactionGate: ReturnType<typeof vi.spyOn> | undefined;
  try {
    // Leave capacity for a second application on a truck with a draft Removal.
    const delivery = await addRemoval(f, STOCK_KG_PER_PRODUCT);
    const input = await lossCommand(f);
    const originalTransaction = db.transaction.bind(db);
    transactionGate = vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) =>
      originalTransaction(async tx => {
        // Pause the real create transaction after its artifact-lock prefix,
        // before allocation FKs acquire product KEY SHARE. No DB results are mocked.
        const lineage = await getLockedCertifiedLineage(f.ctx, tx, { entityType: "delivery", entityId: delivery.id });
        expect(lineage.length).toBeGreaterThan(0);
        expect(lineage.every(row => row.removalSubmissionId === null && row.ghgStatementSubmissionId === null)).toBe(true);
        pid = await backendPid(tx);
        await resume.promise;
        await tx.select({ id: biocharProducts.id }).from(biocharProducts).where(and(
          eq(biocharProducts.organizationId, f.ctx.organizationId), eq(biocharProducts.id, f.product!.id),
        )).for("key share", { noWait: true });
        return callback(tx);
      }, config));
    creating = outcome(createApplication(f.ctx, {
      code: `E2E-LOCK-SECOND-AP-${f.tag}`, deliveryId: delivery.id, applicationDate: new Date(STOCK_TIME),
      biocharAppliedTons: LOSS_KG / KG_PER_TON, fieldSizeHa: 1, evidenceMethod: "location",
    }));
    await expect.poll(() => pid, { timeout: BARRIER_TIMEOUT_MS }).not.toBe(0);
    editing = outcome(updateBiocharProduct(f.ctx, f.product!.id, {
      expectedVersion: input.expectedProductVersions[f.product!.id], status: "testing",
    }));
    await expect.poll(() => blockedQuery(pid), { timeout: BARRIER_TIMEOUT_MS }).toContain("pg_advisory_xact_lock");
    resume.release();
    expect(await creating).toMatchObject({ ok: true });
    expect(await editing).toMatchObject({ ok: true });
    const shares = await db.select().from(applicationOutputAllocations).where(and(
      eq(applicationOutputAllocations.organizationId, f.ctx.organizationId),
      eq(applicationOutputAllocations.biocharProductId, f.product!.id),
    ));
    expect(shares).toHaveLength(2);
  } finally {
    resume.release();
    await Promise.all([creating, editing]);
    transactionGate?.mockRestore();
    await cleanup(f);
  }
}, TEST_TIMEOUT_MS);
