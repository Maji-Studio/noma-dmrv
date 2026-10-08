import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { customers, customerLocations, suppliers, supplierLocations, facilities, feedstockTypes, feedstocks } from "@/db/schema";
import { createSupplierLocation, deleteSupplier, updateSupplierLocation } from "@/data-access/suppliers";
import { createCustomerLocation, deleteCustomer, updateCustomerLocation } from "@/data-access/customers";
import { SafeError } from "@/lib/errors";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const BARRIER_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 15_000;
const INITIAL_VERSION = 1;
const INTAKE_LOCK_TIMEOUT = "500ms";
const INTAKE_DRY_MASS_KG = 100;

beforeAll(() => ensureTestOrg());

async function blockedBy(pid: number) {
  const result = await db.execute<{ pid: number }>(sql`
    select pid from pg_stat_activity
    where ${pid} = any(pg_blocking_pids(pid)) and wait_event_type = 'Lock'
  `);
  return result.rows;
}

describe.each(["supplier", "customer"] as const)("%s location parent-first locks", (kind) => {
  const parents = kind === "supplier" ? suppliers : customers;
  const children = kind === "supplier" ? supplierLocations : customerLocations;

  async function fixture() {
    const tag = crypto.randomUUID();
    const [parent] = await db.insert(parents).values({
      organizationId: TEST_ORG_ID, code: `LOCK-${tag}`, name: `Lock order ${tag}`,
    }).returning();
    const create = () => kind === "supplier"
      ? createSupplierLocation(ctx, { supplierId: parent.id, country: "CH", isDefault: true })
      : createCustomerLocation(ctx, { customerId: parent.id, name: "Location", country: "CH", isDefault: true });
    const location = await create();
    const update = () => kind === "supplier"
      ? updateSupplierLocation(ctx, location.id, { expectedVersion: location.version, isDefault: true })
      : updateCustomerLocation(ctx, location.id, { expectedVersion: location.version, isDefault: true });
    const remove = () => kind === "supplier"
      ? deleteSupplier(ctx, parent.id, parent.version)
      : deleteCustomer(ctx, parent.id, parent.version);
    const readParent = () => db.select().from(parents).where(and(eq(parents.id, parent.id), eq(parents.organizationId, TEST_ORG_ID)));
    const readChildren = () => kind === "supplier"
      ? db.select().from(supplierLocations).where(and(eq(supplierLocations.supplierId, parent.id), eq(supplierLocations.organizationId, TEST_ORG_ID)))
      : db.select().from(customerLocations).where(and(eq(customerLocations.customerId, parent.id), eq(customerLocations.organizationId, TEST_ORG_ID)));
    const cleanup = async () => {
      if (kind === "supplier") {
        await db.delete(supplierLocations).where(and(eq(supplierLocations.supplierId, parent.id), eq(supplierLocations.organizationId, TEST_ORG_ID)));
      } else {
        await db.delete(customerLocations).where(and(eq(customerLocations.customerId, parent.id), eq(customerLocations.organizationId, TEST_ORG_ID)));
      }
      await db.delete(parents).where(and(eq(parents.id, parent.id), eq(parents.organizationId, TEST_ORG_ID)));
    };
    return { parent, location, create, update, remove, readParent, readChildren, cleanup };
  }

  it.each(["create", "update"] as const)("queues deletion behind a %s that is waiting for a child", async (operation) => {
    const f = await fixture();
    let write: Promise<PromiseSettledResult<unknown>[]> | undefined;
    let deletion: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await db.transaction(async (tx) => {
        // Pause the real writer at its first child lock, after its parent lock.
        await tx.select({ id: children.id }).from(children)
          .where(and(eq(children.id, f.location.id), eq(children.organizationId, TEST_ORG_ID))).for("update");
        const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        write = Promise.allSettled([f[operation]()]);
        let writerPid = 0;
        await expect.poll(async () => {
          const waiting = await blockedBy(backend.rows[0].pid);
          writerPid = waiting[0]?.pid ?? 0;
          return waiting.length;
        }, { timeout: BARRIER_TIMEOUT_MS }).toBe(1);
        expect((await f.readParent())[0].version).toBe(INITIAL_VERSION);
        deletion = Promise.allSettled([f.remove()]);
        // This fails on child-first code: delete owns the parent instead of
        // waiting for the writer. No timing sleep stands in for a lock barrier.
        await expect.poll(async () => (await blockedBy(writerPid)).length,
          { timeout: BARRIER_TIMEOUT_MS }).toBe(1);
      });
      expect((await write)![0].status).toBe("fulfilled");
      const outcome = (await deletion)![0];
      if (kind === "supplier") {
        expect(outcome).toEqual({ status: "fulfilled", value: undefined });
        expect(await f.readParent()).toEqual([]);
        expect(await f.readChildren()).toEqual([]);
      } else {
        expect(outcome.status).toBe("rejected");
        if (outcome.status !== "rejected") throw new Error("Expected location guard");
        expect(outcome.reason).toBeInstanceOf(SafeError);
        expect(outcome.reason.message).toContain("still has locations");
        expect((await f.readParent())[0].version).toBe(INITIAL_VERSION);
        expect(await f.readChildren()).toHaveLength(operation === "create" ? 2 : 1);
      }
    } finally {
      await Promise.all([write, deletion]);
      await f.cleanup();
    }
  }, TEST_TIMEOUT_MS);

  if (kind === "supplier") it.each(["create", "update"] as const)(
    "allows a supplier intake insert while a location %s holds the parent lock",
    async (operation) => {
      const f = await fixture();
      const tag = crypto.randomUUID();
      const [facility] = await db.insert(facilities).values({
        organizationId: TEST_ORG_ID, code: `FAC-${tag}`, name: `Lock facility ${tag}`, country: "CH",
      }).returning();
      const [feedstockType] = await db.insert(feedstockTypes).values({
        organizationId: TEST_ORG_ID, code: `FT-${tag}`, name: `Lock feedstock ${tag}`, category: "forestry",
      }).returning();
      let write: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await db.transaction(async (tx) => {
          // Hold the child so the real writer retains its parent lock until
          // the intake has committed. The barrier proves the lock is held.
          await tx.select({ id: supplierLocations.id }).from(supplierLocations)
            .where(and(eq(supplierLocations.id, f.location.id), eq(supplierLocations.organizationId, TEST_ORG_ID)))
            .for("update");
          const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          write = Promise.allSettled([f[operation]()]);
          await expect.poll(async () => (await blockedBy(backend.rows[0].pid)).length,
            { timeout: BARRIER_TIMEOUT_MS }).toBe(1);

          // An old FOR UPDATE parent lock makes this FK check time out.
          // FOR NO KEY UPDATE admits its FOR KEY SHARE lock immediately.
          const [intake] = await db.transaction(async (insertTx) => {
            await insertTx.execute(sql`select set_config('lock_timeout', ${INTAKE_LOCK_TIMEOUT}, true)`);
            return insertTx.insert(feedstocks).values({
              organizationId: TEST_ORG_ID, code: `FI-${tag}`, facilityId: facility.id,
              supplierId: f.parent.id, feedstockTypeId: feedstockType.id,
              massDryKg: INTAKE_DRY_MASS_KG,
            }).returning({ id: feedstocks.id });
          });
          expect(intake.id).toBeTruthy();
          // The writer is still paused: success cannot come from its release.
          expect(await blockedBy(backend.rows[0].pid)).toHaveLength(1);
        });
        expect((await write)![0].status).toBe("fulfilled");
      } finally {
        await write;
        await db.delete(feedstocks).where(and(eq(feedstocks.supplierId, f.parent.id), eq(feedstocks.organizationId, TEST_ORG_ID)));
        await db.delete(feedstockTypes).where(and(eq(feedstockTypes.id, feedstockType.id), eq(feedstockTypes.organizationId, TEST_ORG_ID)));
        await db.delete(facilities).where(and(eq(facilities.id, facility.id), eq(facilities.organizationId, TEST_ORG_ID)));
        await f.cleanup();
      }
    }, TEST_TIMEOUT_MS,
  );

  it("queues default creation behind deletion and returns a defined outcome", async () => {
    const f = await fixture();
    let creation: Promise<PromiseSettledResult<unknown>[]> | undefined;
    let deletion: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.select({ id: parents.id }).from(parents)
          .where(and(eq(parents.id, f.parent.id), eq(parents.organizationId, TEST_ORG_ID))).for("update");
        const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        const pid = backend.rows[0].pid;
        deletion = Promise.allSettled([f.remove()]);
        await expect.poll(async () => (await blockedBy(pid)).length,
          { timeout: BARRIER_TIMEOUT_MS }).toBe(1);
        creation = Promise.allSettled([f.create()]);
        await expect.poll(async () => {
          const result = await db.execute<{ count: number }>(sql`
            with recursive blocked(pid) as (
              select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
              union
              select activity.pid from pg_stat_activity activity
              join blocked blocker on blocker.pid = any(pg_blocking_pids(activity.pid))
            ) select count(*)::int as count from blocked
          `);
          return result.rows[0].count;
        }, { timeout: BARRIER_TIMEOUT_MS }).toBe(2);
      });
      const removed = (await deletion)![0];
      const created = (await creation)![0];
      if (kind === "supplier") {
        expect(removed.status).toBe("fulfilled");
        expect(created.status).toBe("rejected");
        if (created.status !== "rejected") throw new Error("Expected missing parent");
        expect(created.reason).toBeInstanceOf(SafeError);
        expect(created.reason.message).toBe("Supplier was not found.");
        expect(await f.readParent()).toEqual([]);
        expect(await f.readChildren()).toEqual([]);
      } else {
        expect(removed.status).toBe("rejected");
        if (removed.status !== "rejected") throw new Error("Expected location guard");
        expect(removed.reason).toBeInstanceOf(SafeError);
        expect(removed.reason.message).toContain("still has locations");
        expect(created.status).toBe("fulfilled");
        expect((await f.readParent())[0].version).toBe(INITIAL_VERSION);
        expect(await f.readChildren()).toHaveLength(2);
      }
    } finally {
      await Promise.all([creation, deletion]);
      await f.cleanup();
    }
  }, TEST_TIMEOUT_MS);
});
