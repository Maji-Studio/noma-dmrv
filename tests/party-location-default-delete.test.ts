import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { customers, customerLocations, suppliers, supplierLocations } from "@/db/schema";
import { createSupplierLocation, deleteSupplierLocation, updateSupplierLocation } from "./helpers/supplier-location-operations";
import { createCustomerLocation, deleteCustomerLocation, updateCustomerLocation } from "@/data-access/customers";
import { TEST_SITE_POSITION, ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();

beforeAll(() => ensureTestOrg());

describe.each(["supplier", "customer"] as const)("%s location delete keeps a default", (kind) => {
  async function fixture() {
    const tag = crypto.randomUUID();
    if (kind === "supplier") {
      const [parent] = await db.insert(suppliers).values({
        organizationId: TEST_ORG_ID, code: `DEF-${tag}`, name: `Default delete ${tag}`,
      }).returning();
      const first = await createSupplierLocation(ctx, { ...TEST_SITE_POSITION, country: "CH", supplierId: parent.id, name: "A", });
      const second = await createSupplierLocation(ctx, { ...TEST_SITE_POSITION, country: "CH", supplierId: parent.id, name: "B", });
      return {
        parentId: parent.id, first, second,
        remove: (l: { id: string; version: number }) => deleteSupplierLocation(ctx, l.id, l.version),
        uncheck: (l: { id: string; version: number }) =>
          updateSupplierLocation(ctx, l.id, { expectedVersion: l.version, isDefault: false }),
        read: () => db.select().from(supplierLocations)
          .where(and(eq(supplierLocations.supplierId, parent.id), eq(supplierLocations.organizationId, TEST_ORG_ID))),
        cleanup: async () => {
          await db.delete(supplierLocations).where(eq(supplierLocations.supplierId, parent.id));
          await db.delete(suppliers).where(eq(suppliers.id, parent.id));
        },
      };
    }
    const [parent] = await db.insert(customers).values({
      organizationId: TEST_ORG_ID, code: `DEF-${tag}`, name: `Default delete ${tag}`,
    }).returning();
    const first = await createCustomerLocation(ctx, { ...TEST_SITE_POSITION, country: "CH", customerId: parent.id, name: "A", isDefault: true });
    const second = await createCustomerLocation(ctx, { ...TEST_SITE_POSITION, country: "CH", customerId: parent.id, name: "B", });
    return {
      parentId: parent.id, first, second,
      remove: (l: { id: string; version: number }) => deleteCustomerLocation(ctx, l.id, l.version),
      uncheck: (l: { id: string; version: number }) =>
        updateCustomerLocation(ctx, l.id, { expectedVersion: l.version, isDefault: false }),
      read: () => db.select().from(customerLocations)
        .where(and(eq(customerLocations.customerId, parent.id), eq(customerLocations.organizationId, TEST_ORG_ID))),
      cleanup: async () => {
        await db.delete(customerLocations).where(eq(customerLocations.customerId, parent.id));
        await db.delete(customers).where(eq(customers.id, parent.id));
      },
    };
  }

  it("promotes the remaining location when the default is deleted", async () => {
    const f = await fixture();
    try {
      expect(f.first.isDefault).toBe(true);
      expect(f.second.isDefault).toBe(false);
      await f.remove(f.first);
      const rows = await f.read();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(f.second.id);
      expect(rows[0].isDefault).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("leaves the default alone when another location is deleted", async () => {
    const f = await fixture();
    try {
      await f.remove(f.second);
      const rows = await f.read();
      expect(rows.map((r) => [r.id, r.isDefault])).toEqual([[f.first.id, true]]);
    } finally {
      await f.cleanup();
    }
  });

  it("keeps the only default when its checkbox is cleared", async () => {
    const f = await fixture();
    try {
      const updated = await f.uncheck(f.first);
      expect(updated.isDefault).toBe(true);
      const rows = await f.read();
      expect(rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([f.first.id]);
    } finally {
      await f.cleanup();
    }
  });

  it("promotes the lowest id when the remaining candidates tie", async () => {
    const f = await fixture();
    try {
      const TIED_AT = new Date("2026-01-01T00:00:00.000Z");
      const ids = [crypto.randomUUID(), crypto.randomUUID()].sort();
      // Insert the higher id first so insertion order cannot decide the result.
      for (const id of [ids[1], ids[0]]) {
        if (kind === "supplier") {
          await db.insert(supplierLocations).values({
            ...TEST_SITE_POSITION, country: "CH",
            id, organizationId: TEST_ORG_ID, supplierId: f.parentId, name: "T", createdAt: TIED_AT,
          });
        } else {
          await db.insert(customerLocations).values({
            ...TEST_SITE_POSITION, country: "CH",
            id, organizationId: TEST_ORG_ID, customerId: f.parentId, name: "T", createdAt: TIED_AT,
          });
        }
      }
      // Drop the plain second row so only tied candidates remain.
      await f.remove(f.second);
      await f.remove(f.first);
      const rows = await f.read();
      expect(rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([ids[0]]);
    } finally {
      await f.cleanup();
    }
  });
});
