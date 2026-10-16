/**
 * deleteCustomer blocked-delete copy.
 *
 * Orders have no cancellation state, so the old "Cancel or reassign those
 * orders first" message named an action the app cannot perform (#774). These
 * assertions pin the replacement copy verbatim.
 */
import { getTableName, type Table } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const state = vi.hoisted(() => ({ locationCount: 0, orderCount: 0, deleted: false, deleteCount: 0, failDeleteAt: 0 }));

vi.mock("@/db", () => {
  // Minimal stand-in for the three reads deleteCustomer makes: the existence
  // check, then the location and order counts.
  const tableRows = (table: Table) => {
    switch (getTableName(table)) {
      case "customers":
        return [{ id: "customer-1", version: 1 }];
      case "customer_locations":
        return Array.from({ length: state.locationCount }, (_, index) => ({ id: `location-${index}`, version: 1 }));
      case "orders":
        return Array.from({ length: state.orderCount }, (_, index) => ({ code: `ORD-${index}` }));
      case "certifier_storage_locations":
        return [];
      default:
        throw new Error(`Unexpected table read: ${getTableName(table)}`);
    }
  };
  const executor = {
      select: () => ({
        from: (table: Table) => ({
          where: () => {
            const result = Object.assign(Promise.resolve(tableRows(table)), { for: () => result, orderBy: () => result, limit: () => result });
            return result;
          },
        }),
      }),
      delete: () => ({
        where: () => {
          state.deleteCount++;
          if (state.deleteCount === state.failDeleteAt) {
            return Promise.reject({ code: "23503", constraint: "certifier_storage_locations_customer_location_id_organization_i" });
          }
          state.deleted = true;
          return Promise.resolve();
        },
      }),
  };
  return { db: { ...executor, transaction: (callback: (tx: typeof executor) => unknown) => callback(executor) } };
});

const { deleteCustomerInTransaction } = await import("./customer-writes");
const { db } = await import("@/db");
const deleteCustomer = (ctx: OrgContext, customerId: string, expectedVersion: number) => db.transaction(async tx => { await deleteCustomerInTransaction(ctx, tx, { customerId, expectedVersion }); });

const ctx: OrgContext = { userId: "user-1", organizationId: "org-1" } as OrgContext;

beforeEach(() => {
  state.locationCount = 0;
  state.orderCount = 0;
  state.deleted = false;
  state.deleteCount = 0;
  state.failDeleteAt = 0;
});

describe("deleteCustomer", () => {
  it("names only actions that exist when orders still reference the customer", async () => {
    state.orderCount = 2;

    await expect(deleteCustomer(ctx, "customer-1", 1)).rejects.toThrow(
      "Customer was not deleted because orders still use it. Open Orders and review them. Reassign them where appropriate, or keep this customer.",
    );
    expect(state.deleted).toBe(false);
  });

  it("reports only the location identified by the storage-site FK backstop", async () => {
    state.locationCount = 3;
    state.failDeleteAt = 2;
    await expect(deleteCustomer(ctx, "customer-1", 1)).rejects.toMatchObject({
      code: "conflict", issues: [expect.objectContaining({ path: ["customerId"], meta: { locationIds: ["location-1"] } })],
    });
  });

  it("deletes unused locations with the customer", async () => {
    state.locationCount = 1;
    await expect(deleteCustomer(ctx, "customer-1", 1)).resolves.toBeUndefined();
    expect(state.deleted).toBe(true);
  });

  it("deletes when nothing references the customer", async () => {
    await expect(deleteCustomer(ctx, "customer-1", 1)).resolves.toBeUndefined();
    expect(state.deleted).toBe(true);
  });
});
