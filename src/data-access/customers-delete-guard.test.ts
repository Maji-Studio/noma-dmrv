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

const state = vi.hoisted(() => ({ locationCount: 0, orderCount: 0, deleted: false }));

vi.mock("@/db", () => {
  // Minimal stand-in for the three reads deleteCustomer makes: the existence
  // check, then the location and order counts.
  const tableRows = (table: Table) => {
    switch (getTableName(table)) {
      case "customers":
        return [{ id: "customer-1" }];
      case "customer_locations":
        return [{ value: state.locationCount }];
      case "orders":
        return [{ value: state.orderCount }];
      default:
        throw new Error(`Unexpected table read: ${getTableName(table)}`);
    }
  };
  return {
    db: {
      select: () => ({
        from: (table: Table) => ({
          where: () => Promise.resolve(tableRows(table)),
        }),
      }),
      delete: () => ({
        where: () => {
          state.deleted = true;
          return Promise.resolve();
        },
      }),
    },
  };
});

const { deleteCustomer } = await import("./customers");

const ctx: OrgContext = { userId: "user-1", organizationId: "org-1" } as OrgContext;

beforeEach(() => {
  state.locationCount = 0;
  state.orderCount = 0;
  state.deleted = false;
});

describe("deleteCustomer", () => {
  it("names only actions that exist when orders still reference the customer", async () => {
    state.orderCount = 2;

    await expect(deleteCustomer(ctx, "customer-1")).rejects.toThrow(
      "Customer was not deleted because orders still use it. Open Orders and review them. Reassign them where appropriate, or keep this customer.",
    );
    expect(state.deleted).toBe(false);
  });

  it("points at the customer's own locations when locations block the delete", async () => {
    state.locationCount = 1;

    await expect(deleteCustomer(ctx, "customer-1")).rejects.toThrow(
      "Customer was not deleted because it still has locations. Edit the customer and remove its locations first.",
    );
    expect(state.deleted).toBe(false);
  });

  it("deletes when nothing references the customer", async () => {
    await expect(deleteCustomer(ctx, "customer-1")).resolves.toBeUndefined();
    expect(state.deleted).toBe(true);
  });
});
