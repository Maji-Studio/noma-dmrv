import { beforeEach, expect, it, vi } from "vitest";
import type { ApiContext } from "@/lib/auth/api-context";
import { resourceQueries } from "@/lib/api/query-schemas";
import { readTools } from "./read-tools";

const mocks = vi.hoisted(() => ({ suppliers: vi.fn(), customers: vi.fn(), locations: vi.fn(), orders: vi.fn(), order: vi.fn(), balance: vi.fn(), deliveries: vi.fn(), delivery: vi.fn() }));
// No reader can connect to the database in this contract suite.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/api/suppliers-queries", () => ({ readSupplierListFromInput: mocks.suppliers }));
vi.mock("@/lib/api/customers-queries", () => ({ readCustomerListFromInput: mocks.customers }));
vi.mock("@/lib/api/customer-locations-queries", () => ({ readCustomerLocationListFromInput: mocks.locations }));
vi.mock("@/lib/api/orders-queries", () => ({ readOrderListFromInput: mocks.orders }));
vi.mock("@/lib/read-models/api-orders", () => ({ readApiOrder: mocks.order }));
vi.mock("@/lib/api/order-balance-queries", () => ({ readOrderBalanceFromInput: mocks.balance }));

vi.mock("@/lib/api/deliveries-queries", () => ({ readDeliveryListFromInput: mocks.deliveries }));
vi.mock("@/lib/read-models/api-deliveries", () => ({ readApiDelivery: mocks.delivery }));

const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const ctx = { organizationId: "org" } as ApiContext;
const named = (name: string) => readTools.find((tool) => tool.name === name)!;
const INVENTORY = [
  ["find_deliveries", "deliveries:read"], ["get_delivery", "deliveries:read"],
  ["find_customers", "customers:read"], ["find_customer_locations", "customers:read"],
  ["find_orders", "orders:read"], ["get_order", "orders:read"], ["get_order_balance", "orders:read"],
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.suppliers.mockResolvedValue({ data: [], nextCursor: null });
  mocks.customers.mockResolvedValue({ data: [], nextCursor: null });
  mocks.locations.mockResolvedValue({ data: [], nextCursor: null });
  mocks.orders.mockResolvedValue({ data: [], nextCursor: null });
  mocks.order.mockResolvedValue({ code: "OR-1", version: 1 });
  mocks.balance.mockResolvedValue({ data: { remainingWetMassKg: 100, fulfillmentStatus: "no_deliveries" } });
});
it.each(INVENTORY)("registers %s under %s", (name, scope) => {
  expect(named(name)).toMatchObject({ kind: "read", scope });
  expect(named(name).description).not.toMatch(/[–—]/);
});
it("uses the same list input schemas and passes all parsed filters to the REST readers", async () => {
  expect(named("find_customers").input).toBe(resourceQueries.customers.list);
  expect(named("find_orders").input).toBe(resourceQueries.orders.list);
  const filters = { facilityId: ID.toUpperCase(), customerId: ID, formulationId: ID, q: "OR", code: "OR-1", orderedFrom: "2026-09-01", orderedBefore: "2026-10-01", cursor: "cursor", limit: 1 };
  await named("find_orders").execute(ctx, filters);
  expect(mocks.orders).toHaveBeenCalledExactlyOnceWith(ctx, { ...filters, facilityId: ID });
  await named("find_customers").execute(ctx, { q: "C", code: "C-1", limit: 1, cursor: "cursor" });
  expect(mocks.customers).toHaveBeenCalledExactlyOnceWith(ctx, { q: "C", code: "C-1", limit: 1, cursor: "cursor", archived: false });
  expect(named("find_suppliers").input).toBe(resourceQueries.suppliers.list);
  await named("find_suppliers").execute(ctx, { q: "S", limit: 1 });
  expect(mocks.suppliers).toHaveBeenCalledExactlyOnceWith(ctx, { q: "S", limit: 1, archived: false });
});
it("accepts a customer UUID or code and sends the parent and pagination to REST's reader", async () => {
  for (const idOrCode of [ID, "C-1"]) {
    await named("find_customer_locations").execute(ctx, { idOrCode, q: "Site", limit: 1, cursor: "cursor" });
    expect(mocks.locations).toHaveBeenLastCalledWith(ctx, { q: "Site", limit: 1, cursor: "cursor", archived: false }, idOrCode);
  }
});
it("passes the archived destination filter to the shared REST reader", async () => {
  for (const archived of [true, false]) {
    await named("find_customer_locations").execute(ctx, { idOrCode: ID, archived, limit: 1 });
    expect(mocks.locations).toHaveBeenLastCalledWith(ctx, { limit: 1, archived }, ID);
  }
  expect(named("find_customer_locations").description).toContain("archived=true");
  expect(named("find_customer_locations").description).toContain("detail read");
});
it("wraps get in the REST item envelope and passes the balance envelope through unchanged", async () => {
  expect(await named("get_order").execute(ctx, { idOrCode: ID.toUpperCase() })).toEqual({ data: await mocks.order() });
  expect(mocks.order).toHaveBeenCalledWith(ctx, { id: ID });
  const balance = { data: { remainingWetMassKg: 100, fulfillmentStatus: "no_deliveries" } };
  mocks.balance.mockResolvedValueOnce(balance);
  expect(await named("get_order_balance").execute(ctx, { idOrCode: "OR-1" })).toBe(balance);
  expect(mocks.balance).toHaveBeenCalledExactlyOnceWith(ctx, "OR-1");
});
it("rejects unpublished fields and non-calendar list dates before reading", async () => {
  for (const args of [{ orderedFrom: "2026-02-30" }, { orderedFrom: "2026-10-01T00:00:00Z" }, { fulfillmentStatus: "partial" }]) {
    await expect(Promise.resolve().then(() => named("find_orders").execute(ctx, args))).rejects.toMatchObject({ code: "invalid_query" });
  }
  await expect(Promise.resolve().then(() => named("find_customer_locations").execute(ctx, { customerId: ID }))).rejects.toMatchObject({ code: "invalid_query" });
  expect(mocks.orders).not.toHaveBeenCalled();
  expect(mocks.locations).not.toHaveBeenCalled();
});
it("uses the shared pagination summary for each new list read", () => {
  for (const [name, singular, plural] of [
    ["find_customers", "customer", "customers"],
    ["find_customer_locations", "customer location", "customer locations"],
    ["find_orders", "order", "orders"],
  ]) {
    expect(named(name).summarize({ data: [], nextCursor: null })).toBe(`0 ${plural}.`);
    expect(named(name).summarize({ data: [{}], nextCursor: "cursor" })).toBe(`1 ${singular}. More results: pass nextCursor.`);
  }
  expect(named("get_order").summarize({ data: { code: "OR-1", version: 1 } })).toBe("Order OR-1, version 1.");
  expect(named("get_order_balance").summarize({ data: { remainingWetMassKg: 100, fulfillmentStatus: "partial" } })).toBe("Order balance: 100 wet kg remaining (partial).");
});
it("describes balance freshness, reservation limits and delivery grounding", () => {
  expect(named("get_order_balance").description).toContain("without changing the order version");
  expect(named("get_order_balance").description).toContain("not a reservation");
  expect(named("get_order_balance").description).toContain("Call it before recording a delivery");
  expect(named("get_order").description).toContain("expectedVersion");
});

it("shares delivery filters and detail representations with REST", async () => {
  const filters = { facilityId: ID, orderId: ID, storageLocationId: ID, q: "DL", code: "DL-1", deliveredFrom: "2026-09-01T00:00:00Z", deliveredBefore: "2026-10-01T00:00:00Z", limit: 1, cursor: "cursor" };
  expect(named("find_deliveries").input).toBe(resourceQueries.deliveries.list);
  mocks.deliveries.mockResolvedValue({ data: [], nextCursor: null });
  expect(await named("find_deliveries").execute(ctx, filters)).toEqual({ data: [], nextCursor: null });
  expect(mocks.deliveries).toHaveBeenCalledExactlyOnceWith(ctx, filters);
  mocks.delivery.mockResolvedValue({ code: "DL-1", version: 2 });
  expect(await named("get_delivery").execute(ctx, { idOrCode: ID.toUpperCase() })).toEqual({ data: { code: "DL-1", version: 2 } });
  expect(mocks.delivery).toHaveBeenCalledWith(ctx, { id: ID });
  await named("get_delivery").execute(ctx, { idOrCode: "DL-1" });
  expect(mocks.delivery).toHaveBeenLastCalledWith(ctx, { code: "DL-1" });
});
it("gives shared delivery list summaries and names the drawn-product tool and scope", () => {
  expect(named("find_deliveries").summarize({ data: [], nextCursor: null })).toBe("0 deliveries.");
  expect(named("find_deliveries").summarize({ data: [{}], nextCursor: "cursor" })).toBe("1 delivery. More results: pass nextCursor.");
  expect(named("get_delivery").summarize({ data: { code: "DL-1", version: 2 } })).toBe("Delivery DL-1, version 2.");
  expect(named("get_delivery").description).toContain("find_output_stock_movements");
  expect(named("get_delivery").description).toContain("biochar-products:read");
});
it("rejects invalid delivery filters before the reader", async () => {
  for (const args of [{ deliveredFrom: "2026-09-01" }, { deliveredBefore: "2026-09-01T12:00:00" }, { unknown: true }]) {
    await expect(Promise.resolve().then(() => named("find_deliveries").execute(ctx, args))).rejects.toMatchObject({ code: "invalid_query" });
  }
  expect(mocks.deliveries).not.toHaveBeenCalled();
});

it("publishes remaining application mass discovery with REST's exact filter guidance", async () => {
  const tool = named("find_deliveries");
  expect(tool.description).toContain(resourceQueries.deliveries.list.shape.hasRemainingMass.description);
  for (const hasRemainingMass of ["true", "false"]) {
    await tool.execute(ctx, { hasRemainingMass });
    expect(mocks.deliveries).toHaveBeenLastCalledWith(ctx, expect.objectContaining({ hasRemainingMass }));
  }
});
it("appends application reads after the document reads", () => {
  expect(readTools.slice(-5).map(tool => tool.name)).toEqual(["find_documents", "get_document_download_url", "find_applications", "get_application", "get_delivery_application_balance"]);
});
