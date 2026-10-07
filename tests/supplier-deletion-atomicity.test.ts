import { masterDataVersion } from "./helpers/master-data-version";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { pgErrorCode } from "@/db/errors";
import { facilities, feedstockDeliveries, feedstocks, feedstockTypes, organizations, supplierLocations, suppliers } from "@/db/schema";
import { deleteSupplier } from "@/data-access/suppliers";
import { SafeError } from "@/lib/errors";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const CONCURRENCY_BARRIER_TIMEOUT_MS = 5_000;
const CONCURRENCY_TEST_TIMEOUT_MS = 10_000;
const PG_FOREIGN_KEY_VIOLATION = "23503";
let supplierId: string;
let facilityId: string;
let feedstockTypeId: string;
let originalLocations: (typeof supplierLocations.$inferSelect)[];

beforeAll(() => ensureTestOrg());
beforeEach(async () => {
  const tag = crypto.randomUUID();
  const [supplier] = await db.insert(suppliers).values({ organizationId: TEST_ORG_ID, code: `SUP-${tag}`, name: `Audit supplier ${tag}` }).returning();
  supplierId = supplier.id;
  originalLocations = await db.insert(supplierLocations).values([
    { organizationId: TEST_ORG_ID, supplierId, country: "Switzerland", city: "Zurich", isDefault: true },
    { organizationId: TEST_ORG_ID, supplierId, country: "France", city: "Lyon" },
  ]).returning();
  const [facility] = await db.insert(facilities).values({ organizationId: TEST_ORG_ID, code: `FAC-${tag}`, name: `Audit facility ${tag}` }).returning();
  facilityId = facility.id;
  const [type] = await db.insert(feedstockTypes).values({ organizationId: TEST_ORG_ID, code: `FT-${tag}`, name: `Audit type ${tag}`, category: "forestry" }).returning();
  feedstockTypeId = type.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (supplierId) {
    await db.delete(feedstocks).where(eq(feedstocks.supplierId, supplierId));
    await db.delete(feedstockDeliveries).where(eq(feedstockDeliveries.supplierId, supplierId));
    await db.delete(supplierLocations).where(eq(supplierLocations.supplierId, supplierId));
    await db.delete(suppliers).where(eq(suppliers.id, supplierId));
  }
  if (feedstockTypeId) await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockTypeId));
  if (facilityId) await db.delete(facilities).where(eq(facilities.id, facilityId));
});

async function insertReference(kind: "intake" | "delivery") {
  const common = { organizationId: TEST_ORG_ID, supplierId, facilityId, code: `REF-${crypto.randomUUID()}` };
  if (kind === "delivery") {
    await db.insert(feedstockDeliveries).values({ ...common, deliveryDate: new Date() });
  } else {
    await db.insert(feedstocks).values({ ...common, feedstockTypeId, massDryKg: 10 });
  }
}
async function expectUnchanged() {
  expect(await db.select().from(suppliers).where(eq(suppliers.id, supplierId))).toHaveLength(1);
  const locations = await db.select().from(supplierLocations).where(eq(supplierLocations.supplierId, supplierId));
  expect(locations.sort((a, b) => a.id.localeCompare(b.id)))
    .toEqual([...originalLocations].sort((a, b) => a.id.localeCompare(b.id)));
}

// Keep PostgreSQL and the real transaction in the loop. Intercept only the
// final parent statement, after the real child DELETE has already executed.
function beforeParentDelete(work: (tx: DbTransaction) => Promise<void>) {
  const transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation((callback, config) => transaction(async (tx) => {
    const deleteFrom = tx.delete.bind(tx);
    vi.spyOn(tx, "delete").mockImplementation((table) => {
      const builder = deleteFrom(table);
      if (table === suppliers) {
        const returning = builder.returning.bind(builder);
        vi.spyOn(builder, "returning").mockImplementation((...args: Parameters<typeof returning>) => {
          const query = returning(...args);
          const execute = query.execute.bind(query);
          vi.spyOn(query, "execute").mockImplementation(async (...executeArgs) => {
            await work(tx);
            return execute(...executeArgs);
          });
          return query;
        });
      }
      return builder;
    });
    return callback(tx);
  }, config));
}

describe("supplier deletion PostgreSQL atomicity", () => {
  it.each(["intake", "delivery"] as const)("retains every location when a %s is the only reference", async (kind) => {
    await insertReference(kind);
    const result = await deleteSupplier(ctx, supplierId, await masterDataVersion(ctx, "suppliers", supplierId)).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(SafeError);
    expect(result).toMatchObject({ message: expect.stringContaining(kind === "intake" ? "intakes" : "deliveries") });
    await expectUnchanged();
  });

  it("rolls back children when the parent statement fails unexpectedly", async () => {
    const failure = new Error("Injected parent delete failure");
    beforeParentDelete(async () => { throw failure; });
    await expect(deleteSupplier(ctx, supplierId, await masterDataVersion(ctx, "suppliers", supplierId))).rejects.toBe(failure);
    await expectUnchanged();
  });

  it.each(["intake", "delivery"] as const)("blocks concurrent %s insertion until deletion commits, then refuses its FK", async (kind) => {
    let insertOutcome: Promise<PromiseSettledResult<void>[]> | undefined;
    const inserted = vi.fn(async (tx: DbTransaction) => {
      const backend = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      );
      const deleteBackendPid = backend.rows[0].pid;
      // The FK needs FOR KEY SHARE on the supplier, so awaiting the insert
      // here would deadlock the hook against the delete's FOR UPDATE lock.
      insertOutcome = Promise.allSettled([insertReference(kind)]);
      await expect.poll(async () => {
        const result = await db.execute<{ insert_blocked: boolean }>(sql`
          select exists (
            select 1 from pg_stat_activity
            where ${deleteBackendPid} = any(pg_blocking_pids(pid))
              and wait_event_type = 'Lock'
          ) as insert_blocked
        `);
        return result.rows[0]?.insert_blocked ?? false;
      }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(true);
    });
    beforeParentDelete(inserted);
    try {
      await expect(deleteSupplier(ctx, supplierId, await masterDataVersion(ctx, "suppliers", supplierId))).resolves.toBeUndefined();
      expect(inserted).toHaveBeenCalledOnce();
      expect(insertOutcome).toBeDefined();
      const [outcome] = (await insertOutcome)!;
      expect(outcome.status).toBe("rejected");
      if (outcome.status !== "rejected") throw new Error("Expected the concurrent insert to fail");
      expect(pgErrorCode(outcome.reason)).toBe(PG_FOREIGN_KEY_VIOLATION);
      expect(await db.select().from(suppliers).where(eq(suppliers.id, supplierId))).toEqual([]);
      expect(await db.select().from(supplierLocations).where(eq(supplierLocations.supplierId, supplierId))).toEqual([]);
      expect(await db.select().from(feedstocks).where(eq(feedstocks.supplierId, supplierId))).toEqual([]);
      expect(await db.select().from(feedstockDeliveries).where(eq(feedstockDeliveries.supplierId, supplierId))).toEqual([]);
    } finally {
      // Also drain the insert after a failed barrier/assertion: the delete has
      // committed or rolled back before fixture cleanup can remove its rows.
      await insertOutcome;
    }
  }, CONCURRENCY_TEST_TIMEOUT_MS);

  it("deletes an unreferenced supplier and all locations", async () => {
    await deleteSupplier(ctx, supplierId, await masterDataVersion(ctx, "suppliers", supplierId));
    expect(await db.select().from(suppliers).where(eq(suppliers.id, supplierId))).toEqual([]);
    expect(await db.select().from(supplierLocations).where(eq(supplierLocations.supplierId, supplierId))).toEqual([]);
  });

  it("does not modify a supplier in another organization", async () => {
    const otherOrg = `org-audit-${crypto.randomUUID()}`;
    await db.insert(organizations).values({ id: otherOrg, name: otherOrg, slug: otherOrg });
    try {
      await expect(deleteSupplier({ ...ctx, organizationId: otherOrg }, supplierId, await masterDataVersion({ ...ctx, organizationId: otherOrg }, "suppliers", supplierId))).rejects.toThrow("Supplier was not found.");
      await expectUnchanged();
    } finally {
      await db.delete(organizations).where(eq(organizations.id, otherOrg));
    }
  });
});
