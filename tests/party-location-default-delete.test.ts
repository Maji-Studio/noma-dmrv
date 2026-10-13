import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { customers, customerLocations, suppliers, supplierLocations } from "@/db/schema";
import { createSupplierLocation, deleteSupplierLocation } from "@/data-access/suppliers";
import { createCustomerLocation, deleteCustomerLocation } from "@/data-access/customers";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();

beforeAll(() => ensureTestOrg());

describe.each(["supplier", "customer"] as const)("%s location delete keeps a default", (kind) => {
  async function fixture() {
    const tag = crypto.randomUUID();
    if (kind === "supplier") {
      const [parent] = await db.insert(suppliers).values({
        organizationId: TEST_ORG_ID, code: `DEF-${tag}`, name: `Default delete ${tag}`,
      }).returning();
      const first = await createSupplierLocation(ctx, { supplierId: parent.id, name: "A", country: "CH" });
      const second = await createSupplierLocation(ctx, { supplierId: parent.id, name: "B", country: "CH" });
      return {
        first, second,
        remove: (l: { id: string; version: number }) => deleteSupplierLocation(ctx, l.id, l.version),
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
    const first = await createCustomerLocation(ctx, { customerId: parent.id, name: "A", country: "CH", isDefault: true });
    const second = await createCustomerLocation(ctx, { customerId: parent.id, name: "B", country: "CH" });
    return {
      first, second,
      remove: (l: { id: string; version: number }) => deleteCustomerLocation(ctx, l.id, l.version),
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
});
