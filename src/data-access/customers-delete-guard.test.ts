/** Customer delete refusal copy and storage-site FK mapping. Database fully mocked. */
import { getTableName, type Table } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const state = vi.hoisted(() => ({ locationCount: 0, deliveryCount: 0, deleted: false, deleteCount: 0, failDeleteAt: 0 }));

vi.mock("@/db", () => {
  // Minimal table results for the delete guards; no database connection.
  const tableRows = (table: Table) => {
    switch (getTableName(table)) {
      case "customers":
        return [{ id: "customer-1", version: 1 }];
      case "customer_locations":
        return Array.from({ length: state.locationCount }, (_, index) => ({ id: `location-${index}`, version: 1 }));
      case "orders":
      case "facilities":
        return [];
      case "deliveries":
        return Array.from({ length: state.deliveryCount }, (_, index) => ({ code: `DEL-${index}` }));
      case "certifier_storage_locations":
        return [];
      default:
        throw new Error(`Unexpected table read: ${getTableName(table)}`);
    }
  };
  const executor = {
      execute: () => Promise.resolve({ rows: [{ acquired: true }] }),
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

vi.mock("./orders", () => ({ deleteOrderInTransaction: vi.fn() }));
vi.mock("./transport-legs", () => ({ lockBiocharTransportRouteTopology: vi.fn() }));

const { deleteCustomerInTransaction } = await import("./customer-writes");
const { db } = await import("@/db");
const deleteCustomer = (ctx: OrgContext, customerId: string, expectedVersion: number) => db.transaction(async tx => { await deleteCustomerInTransaction(ctx, tx, { customerId, expectedVersion }); });

const ctx: OrgContext = { userId: "user-1", organizationId: "org-1" } as OrgContext;

beforeEach(() => {
  state.locationCount = 0;
  state.deliveryCount = 0;
  state.deleted = false;
  state.deleteCount = 0;
  state.failDeleteAt = 0;
});

describe("deleteCustomer", () => {
  it("refuses when deliveries were recorded, including archived deliveries", async () => {
    state.deliveryCount = 2;

    await expect(deleteCustomer(ctx, "customer-1", 1)).rejects.toThrow(
      "Customer was not deleted because deliveries were recorded on its orders. Archive it instead.",
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
