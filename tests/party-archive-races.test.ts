import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000"; });
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { customers, customerLocations, suppliers, orders, feedstocks } from "@/db/schema";
import * as supplierOps from "@/lib/operations/suppliers";
import * as customerOps from "@/lib/operations/customers";
import { logFeedstockDelivery, updateFeedstock } from "@/lib/operations/feedstocks";
import { recordOrder, updateOrder } from "@/lib/operations/orders";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { createSupplierLocation, updateSupplierLocation, getSupplierLocationsBySupplier } from "@/data-access/suppliers";
import { createSupplierLocationInTransaction } from "@/data-access/supplier-writes";
import { createCustomerLocation, updateCustomerLocation, getCustomerLocations } from "@/data-access/customers";
import { createCustomerLocationInTransaction } from "@/data-access/customer-create";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";
import { orderInput, createOrderDestination } from "./helpers/order-operation-fixture";
import { createPartyArchiveFixture, cleanupPartyArchiveFixture, partyIntakeInput, type PartyArchiveFixture } from "./helpers/party-archive-fixture";

const TIMEOUT_MS = 60_000;
const BARRIER_CONNECTIONS = 2;
const WRITER_CONNECTIONS = 2;
const site = { name: "E2E Race field", country: "TZ", gpsLatitude: -8, gpsLongitude: 34 };
let barriers: Pool;
let writers: Pool;
const fixtures: PartyArchiveFixture[] = [];
beforeAll(() => { barriers = createTestPool(BARRIER_CONNECTIONS); writers = createTestPool(WRITER_CONNECTIONS); });
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPartyArchiveFixture(f); });
afterAll(async () => { await barriers.end(); await writers.end(); });
async function fixture() { const f = await createPartyArchiveFixture(); fixtures.push(f); return f; }
function settle(work: Promise<unknown>) {
  return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

// Queue real row-lock requests behind a separate connection, observing every
// waiter (including transitive waits) before releasing the party row.
async function queue(f: PartyArchiveFixture, kind: "supplier" | "customer", id: string, calls: (() => Promise<unknown>)[]) {
  const barrier = await openOperationBarrier(barriers);
  const pending: ReturnType<typeof settle>[] = [];
  try {
    const table = kind === "supplier" ? suppliers : customers;
    await barrier.tx.select().from(table)
      .where(and(eq(table.organizationId, f.ctx.organizationId), eq(table.id, id))).for("update");
    for (const [index, call] of calls.entries()) {
      pending.push(settle(call()));
      await waitForBlockedOperations(barriers, barrier.pid, index + 1);
    }
    await barrier.commit();
  } catch (error) {
    await barrier.rollback();
    await Promise.allSettled(pending);
    throw error;
  }
  return Promise.all(pending);
}

for (const kind of ["supplier", "customer"] as const) {
  const noun = kind === "supplier" ? "Supplier" : "Customer";
  const table = kind === "supplier" ? suppliers : customers;
  const archive = (f: PartyArchiveFixture, id: string) => kind === "supplier"
    ? runOperation(supplierOps.archiveSupplier, f.ctx, { supplierId: id, expectedVersion: 1 }, { pool: writers })
    : runOperation(customerOps.archiveCustomer, f.ctx, { customerId: id, expectedVersion: 1 }, { pool: writers });

  describe(`${kind} archive serialization`, { timeout: TIMEOUT_MS }, () => {
    for (const path of ["create reference", "repoint reference", "location create", "location primitive", "location update", "location pair create", "location pair update"] as const) {
      it.each([true, false])(`${path}, archive first: %s`, async archiveFirst => {
        const f = await fixture(); const row = kind === "supplier" ? f.supplier : f.customer;
        const pairs = [{ facilityId: f.facility.id, distanceKm: 15, distanceSource: "manual" as const }];
        let write: () => Promise<unknown>;
        let changedLocationId: string | undefined;
        if (path === "create reference") {
          write = () => kind === "supplier"
            ? runOperation(logFeedstockDelivery, f.ctx, partyIntakeInput(f), { pool: writers })
            : runOperation(recordOrder, f.ctx, orderInput(f), { pool: writers });
        } else if (path === "repoint reference") {
          if (kind === "supplier") {
            const other = (await runOperationInProcess(supplierOps.createSupplier, f.ctx, { name: "E2E Race other", locations: [site] })).supplier;
            const intake = (await runOperation(logFeedstockDelivery, f.ctx, partyIntakeInput(f, other.id))).data.feedstocks[0];
            write = () => runOperation(updateFeedstock, f.ctx, { feedstockId: intake.id, expectedVersion: intake.version, supplierId: row.id }, { pool: writers });
          } else {
            // A destination change under the same customer is a new reference.
            const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
            const destination = await createOrderDestination(f);
            write = () => runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: order.version, customerLocationId: destination.id }, { pool: writers });
          }
        } else if (path === "location create" || path === "location pair create") {
          const data = { ...site, isDefault: true, facilityDistances: path === "location pair create" ? pairs : undefined };
          write = () => kind === "supplier"
            ? createSupplierLocation(f.ctx, { ...data, supplierId: row.id })
            : createCustomerLocation(f.ctx, { ...data, customerId: row.id });
        } else if (path === "location primitive") {
          write = () => db.transaction<unknown>(tx => kind === "supplier"
            ? createSupplierLocationInTransaction(f.ctx, tx, row.id, { ...site, isDefault: true })
            : createCustomerLocationInTransaction(f.ctx, tx, row.id, { ...site, isDefault: true }));
        } else {
          // Promote a second location, including pairs on the stronger supplier
          // FOR UPDATE path. Archive must never acquire this child after parent.
          if (kind === "supplier") {
            await createSupplierLocation(f.ctx, { ...site, supplierId: row.id });
            const location = await createSupplierLocation(f.ctx, { ...site, supplierId: row.id, name: "E2E Promoted field" });
            changedLocationId = location.id;
            write = () => updateSupplierLocation(f.ctx, location.id, { expectedVersion: location.version, isDefault: true,
              facilityDistances: path === "location pair update" ? pairs : undefined });
          } else {
            await db.update(customerLocations).set({ isDefault: true }).where(eq(customerLocations.id, f.location.id));
            const location = await createCustomerLocation(f.ctx, { ...site, customerId: row.id });
            changedLocationId = location.id;
            write = () => updateCustomerLocation(f.ctx, location.id, { expectedVersion: location.version, isDefault: true,
              facilityDistances: path === "location pair update" ? pairs : undefined });
          }
        }
        const transition = () => archive(f, row.id);
        const results = await queue(f, kind, row.id, archiveFirst ? [transition, write] : [write, transition]);
        expect(results[0].ok).toBe(true);
        if (archiveFirst) {
          expect(results[1]).toMatchObject({ ok: false, error: { code: "not_found",
            message: `${noun} ${row.code} is archived. Restore it or choose another ${kind}.`,
            issues: [expect.objectContaining({ path: [`${kind}Id`] })] } });
        } else expect(results[1].ok).toBe(true);
        expect(await db.select().from(table).where(eq(table.id, row.id))).toMatchObject([{ version: 2, archivedAt: expect.any(Date) }]);
        if (changedLocationId) {
          const children = kind === "supplier" ? await getSupplierLocationsBySupplier(f.ctx, row.id) : await getCustomerLocations(f.ctx, row.id);
          expect(children.find(location => location.id === changedLocationId)).toMatchObject({ version: archiveFirst ? 1 : 2, isDefault: !archiveFirst });
        }
      });
    }

    it.each([true, false])("echoed reference PATCH and archive both succeed, archive first: %s", async archiveFirst => {
      const f = await fixture(); const row = kind === "supplier" ? f.supplier : f.customer;
      const order = kind === "customer" ? (await runOperation(recordOrder, f.ctx, orderInput(f))).data : undefined;
      const intake = kind === "supplier" ? (await runOperation(logFeedstockDelivery, f.ctx, partyIntakeInput(f))).data.feedstocks[0] : undefined;
      const write = () => kind === "supplier"
        ? runOperation(updateFeedstock, f.ctx, { feedstockId: intake!.id, expectedVersion: 1, supplierId: row.id, notes: "Kept" }, { pool: writers })
        : runOperation(updateOrder, f.ctx, { orderId: order!.id, expectedVersion: 1, customerId: row.id, customerLocationId: f.location.id, quantityKg: 200 }, { pool: writers });
      const transition = () => archive(f, row.id);
      expect(await queue(f, kind, row.id, archiveFirst ? [transition, write] : [write, transition])).toMatchObject([{ ok: true }, { ok: true }]);
      if (order) expect(await db.select().from(orders).where(eq(orders.id, order.id))).toMatchObject([{ version: 2, quantityKg: 200, customerId: row.id }]);
      if (intake) expect(await db.select().from(feedstocks).where(eq(feedstocks.id, intake.id))).toMatchObject([{ version: 2, supplierId: row.id }]);
    });

    for (const path of ["delete", "update"] as const) {
      it.each([true, false])(`${path}, archive first: %s`, async archiveFirst => {
        const f = await fixture();
        const row = kind === "supplier"
          ? (await runOperationInProcess(supplierOps.createSupplier, f.ctx, { name: "E2E Race unused", locations: [site] })).supplier
          : f.otherCustomer;
        const transition = () => archive(f, row.id);
        const write = () => {
          if (kind === "supplier") {
            const input = { supplierId: row.id, expectedVersion: 1 };
            return path === "delete" ? runOperation(supplierOps.deleteSupplier, f.ctx, input, { pool: writers })
              : runOperation(supplierOps.updateSupplier, f.ctx, { ...input, name: "E2E Changed first" }, { pool: writers });
          }
          const input = { customerId: row.id, expectedVersion: 1 };
          return path === "delete" ? runOperation(customerOps.deleteCustomer, f.ctx, input, { pool: writers })
            : runOperation(customerOps.updateCustomer, f.ctx, { ...input, name: "E2E Changed first" }, { pool: writers });
        };
        const results = await queue(f, kind, row.id, archiveFirst ? [transition, write] : [write, transition]);
        expect(results[0].ok).toBe(true);
        expect(results[1]).toMatchObject({ ok: false, error: { code: path === "delete"
          ? (archiveFirst ? "stale_version" : "not_found") : (archiveFirst ? "not_found" : "stale_version") } });
        const rows = await db.select().from(table).where(eq(table.id, row.id));
        if (path === "delete" && !archiveFirst) expect(rows).toEqual([]);
        else expect(rows).toMatchObject([{ version: 2, archivedAt: archiveFirst ? expect.any(Date) : null }]);
      });
    }
  });
}
