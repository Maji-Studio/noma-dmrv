import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, feedstockDeliveries, feedstocks, feedstockTypes, organizations, supplierLocations, suppliers } from "@/db/schema";
import { deleteSupplier } from "@/data-access/suppliers";
import { SafeError } from "@/lib/errors";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();
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
function beforeParentDelete(work: () => Promise<void>) {
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
            await work();
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
    const result = await deleteSupplier(ctx, supplierId).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(SafeError);
    expect(result).toMatchObject({ message: expect.stringContaining(kind === "intake" ? "intakes" : "deliveries") });
    await expectUnchanged();
  });

  it("rolls back children when the parent statement fails unexpectedly", async () => {
    const failure = new Error("Injected parent delete failure");
    beforeParentDelete(async () => { throw failure; });
    await expect(deleteSupplier(ctx, supplierId)).rejects.toBe(failure);
    await expectUnchanged();
  });

  it.each(["intake", "delivery"] as const)("rolls back children and maps FK refusal after concurrent %s insertion", async (kind) => {
    const inserted = vi.fn(async () => insertReference(kind));
    beforeParentDelete(inserted);
    const result = await deleteSupplier(ctx, supplierId).catch((error: unknown) => error);
    expect(inserted).toHaveBeenCalledOnce();
    expect(result).toBeInstanceOf(SafeError);
    expect(result).toMatchObject({ message: expect.stringContaining(kind === "intake" ? "intakes" : "deliveries") });
    await expectUnchanged();
  });

  it("deletes an unreferenced supplier and all locations", async () => {
    await deleteSupplier(ctx, supplierId);
    expect(await db.select().from(suppliers).where(eq(suppliers.id, supplierId))).toEqual([]);
    expect(await db.select().from(supplierLocations).where(eq(supplierLocations.supplierId, supplierId))).toEqual([]);
  });

  it("does not modify a supplier in another organization", async () => {
    const otherOrg = `org-audit-${crypto.randomUUID()}`;
    await db.insert(organizations).values({ id: otherOrg, name: otherOrg, slug: otherOrg });
    try {
      await expect(deleteSupplier({ ...ctx, organizationId: otherOrg }, supplierId)).rejects.toThrow("Supplier was not found.");
      await expectUnchanged();
    } finally {
      await db.delete(organizations).where(eq(organizations.id, otherOrg));
    }
  });
});
