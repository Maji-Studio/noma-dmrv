/** Real handlers and credentials. Run only by explicit path on the worktree test database. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, drivers, orders, storageLocations, vehicles } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/deliveries/route";
import { GET } from "@/app/api/v1/deliveries/[idOrCode]/route";
import { GET as LIST_ORDERS } from "@/app/api/v1/orders/route";
import { createApiKey } from "@/data-access/api-keys";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import { recordDelivery, updateDeliveryOperation } from "@/lib/operations/deliveries";
import { runOperationInProcess } from "@/lib/operations/runner";
import { deliveryRepresentationSchema, representDelivery } from "@/lib/representations/deliveries";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { lookupProblem } from "./helpers/api-lookups";
import { createApiOrderReadFixture, insertReadOrder, readParams, readRequest, removeApiOrderReadFixture,
  READ_ARCHIVE_AT, READ_TIMEOUT_MS, UNKNOWN_READ_ID, type ApiOrderReadFixture } from "./helpers/api-order-read-fixture";

const PAGE_LIMIT = 1;
const AT = "2026-09-14T12:00:00.000Z";
const LATER = "2026-09-15T12:00:00.000Z";
const WET_KG = 12.345;
const DRY_KG = 9.876;
const MOISTURE = 20.000001;
const REQUESTED_DISTANCE_KM = 123.456789;
const STORED_DISTANCE_KM = 123.45679;
type Fixture = ApiOrderReadFixture & { deliveryKey: string; deliveryWriteKey: string };
let a: Fixture;
let b: Fixture;
let first: typeof deliveries.$inferSelect;
let second: typeof first;
let other: typeof first;
async function fixture(): Promise<Fixture> {
  const f = await createApiOrderReadFixture();
  const makeKey = async (scope: "deliveries:read" | "deliveries:write") => (await createApiKey(f.ctx, {
    name: "Delivery reads", scopes: [scope], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
  })).key;
  return { ...f, deliveryKey: await makeKey("deliveries:read"), deliveryWriteKey: await makeKey("deliveries:write") };
}
async function insert(f: Fixture, orderId: string, values: Partial<typeof deliveries.$inferInsert> = {}) {
  const [row] = await db.insert(deliveries).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    orderId, storageLocationId: f.bin.id, code: `DL-READ-${randomUUID()}`, deliveryDate: new Date(AT),
    deliveredWetMassKg: WET_KG, massDryKg: DRY_KG, moistureContentPercent: MOISTURE,
    createdAt: new Date(AT), ...values }).returning();
  return row;
}
const list = (query = "", key = a.deliveryKey) => LIST(readRequest(`/deliveries${query}`, key));
const get = (id: string, key = a.deliveryKey, query = "") => GET(readRequest(`/deliveries/${encodeURIComponent(id)}${query}`, key), readParams(id));
const ids = async (response: Response): Promise<string[]> => (await response.json()).data.map((row: { id: string }) => row.id);

beforeEach(async () => {
  a = await fixture(); b = await fixture();
  const order = await insertReadOrder(a, `OR-READ-${a.tag}`);
  const otherOrder = await insertReadOrder(a, `OR-OTHER-${a.tag}`, { facilityId: a.otherFacility.id });
  first = await insert(a, order.id, { code: `DL-FIRST-${a.tag}` });
  second = await insert(a, order.id, { deliveryDate: new Date(LATER) });
  const [otherBin] = await db.insert(storageLocations).values({ organizationId: a.ctx.organizationId,
    facilityId: a.otherFacility.id, type: "product_bin", code: `PB-OTHER-${a.tag}`, name: `E2E Other bin ${a.tag}` }).returning();
  other = await insert(a, otherOrder.id, { facilityId: a.otherFacility.id, storageLocationId: otherBin.id,
    deliveryDate: new Date("2026-09-13T12:00:00Z"), createdAt: new Date(LATER) });
}, READ_TIMEOUT_MS);
afterEach(async () => { await removeApiOrderReadFixture(a); await removeApiOrderReadFixture(b); }, READ_TIMEOUT_MS);

describe("delivery REST reads", { timeout: READ_TIMEOUT_MS }, () => {
  it("serves the exact stored shape by id, code and uppercase UUID with a strong ETag", async () => {
    for (const identifier of [first.id, first.code, first.id.toUpperCase()]) {
      const response = await get(identifier);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe('"1.2"');
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const { data } = await response.json();
      expect(data).toEqual(representDelivery({ ...first, orderCustomerLocationId: a.location.id }));
      expect(Object.keys(data).sort()).toEqual(Object.keys(deliveryRepresentationSchema.shape).sort());
      expect(data).toMatchObject({ deliveredAt: AT, deliveredWetMassKg: WET_KG, dryBiocharKg: DRY_KG, moisturePercent: MOISTURE,
        driverId: null, vehicleId: null, distanceKmOverride: null, distanceSource: null, distanceNote: null,
        destinationCustomerLocationId: a.location.id, archivedAt: null });
    }
  });

  it("reads every optional delivery field with the pg real distance precision", async () => {
    try {
      const [driver] = await db.insert(drivers).values({ organizationId: a.ctx.organizationId,
        code: `DR-READ-${a.tag}`, name: `E2E Driver ${a.tag}` }).returning();
      const [vehicle] = await db.insert(vehicles).values({ organizationId: a.ctx.organizationId,
        code: `VH-READ-${a.tag}`, name: `E2E Vehicle ${a.tag}`, vehicleType: "truck" }).returning();
      const row = await insert(a, first.orderId, { driverId: driver.id, vehicleId: vehicle.id,
        distanceKmOverride: REQUESTED_DISTANCE_KM, distanceSource: "document", distanceNote: "Route evidence" });
      const response = await get(row.id);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({ driverId: driver.id, vehicleId: vehicle.id,
        distanceKmOverride: STORED_DISTANCE_KM, distanceSource: "document", distanceNote: "Route evidence",
        destinationCustomerLocationId: a.location.id });
    } finally {
      await db.update(deliveries).set({ driverId: null, vehicleId: null })
        .where(eq(deliveries.organizationId, a.ctx.organizationId));
      await db.delete(drivers).where(eq(drivers.organizationId, a.ctx.organizationId));
      await db.delete(vehicles).where(eq(vehicles.organizationId, a.ctx.organizationId));
    }
  });

  it("resolves list and detail destinations from orders, including a missing destination", async () => {
    const order = await insertReadOrder(a, `OR-NO-DEST-${a.tag}`, { customerLocationId: null });
    const row = await insert(a, order.id);
    const page = await (await list()).json();
    expect(page.data.find((item: { id: string }) => item.id === first.id).destinationCustomerLocationId).toBe(a.location.id);
    expect(page.data.find((item: { id: string }) => item.id === row.id).destinationCustomerLocationId).toBeNull();
    expect((await (await get(row.id)).json()).data.destinationCustomerLocationId).toBeNull();
  });

  it("rejects an orders cursor reused for deliveries", async () => {
    const response = await LIST_ORDERS(readRequest(`/orders?limit=${PAGE_LIMIT}`, a.orderKey));
    expect(response.status).toBe(200);
    const { nextCursor } = await response.json();
    expect(nextCursor).toEqual(expect.any(String));
    await lookupProblem(await list(`?cursor=${encodeURIComponent(nextCursor)}`), 400, "invalid_cursor");
  });

  it("pages by descending createdAt and UUID ties with bound filters and no totals", async () => {
    const expected = [other.id, ...[first.id, second.id].sort().reverse()];
    expect(await ids(await list())).toEqual(expected);
    const firstPage = await (await list(`?limit=${PAGE_LIMIT}`)).json();
    expect(firstPage).not.toHaveProperty("total");
    await lookupProblem(await list(`?orderId=${first.orderId}&cursor=${firstPage.nextCursor}`), 400, "invalid_cursor");
    await lookupProblem(await list(`?cursor=${firstPage.nextCursor}`, b.deliveryKey), 400, "invalid_cursor");
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await (await list(`?limit=${PAGE_LIMIT}${cursor ? `&cursor=${cursor}` : ""}`)).json();
      seen.push(...page.data.map((row: { id: string }) => row.id)); cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(expected);
  });

  it("filters every published field with inclusive from and exclusive before instants", async () => {
    const expected = [first.id, second.id].sort().reverse();
    for (const [name, value] of [["facilityId", a.facility.id], ["orderId", first.orderId], ["storageLocationId", a.bin.id]]) {
      expect(await ids(await list(`?${name}=${value.toUpperCase()}`))).toEqual(expected);
    }
    expect(await ids(await list(`?code=${first.code}`))).toEqual([first.id]);
    expect(await ids(await list("?q=dl-first"))).toEqual([first.id]);
    expect(await ids(await list("?q=%25"))).toEqual([]);
    expect(await ids(await list(`?deliveredFrom=${AT}&deliveredBefore=${LATER}`))).toEqual([first.id]);
    expect(await ids(await list(`?deliveredFrom=${LATER}`))).toEqual([second.id]);
    expect(await ids(await list(`?deliveredBefore=${AT}`))).toEqual([other.id]);
    expect(await ids(await list("?deliveredFrom=2026-09-14T15:00:00%2B03:00&deliveredBefore=2026-09-15T15:00:00%2B03:00"))).toEqual([first.id]);
    expect(await ids(await list(`?deliveredFrom=${AT}&deliveredBefore=${AT}`))).toEqual([]);
    const page = await (await list(`?orderId=${first.orderId}&limit=${PAGE_LIMIT}`)).json();
    expect(await ids(await list(`?orderId=${first.orderId.toUpperCase()}&cursor=${page.nextCursor}`))).toEqual(expected.slice(PAGE_LIMIT));
    for (const query of ["?unknown=1", "?deliveredFrom=2026-09-14", "?deliveredBefore=2026-09-14T12:00:00", "?orderId=bad", "?limit=1&limit=2"]) {
      await lookupProblem(await list(query), 400, "invalid_query");
    }
    await lookupProblem(await get(first.id, a.deliveryKey, "?q=x"), 400, "invalid_query");
  });

  it("hides archived deliveries from lists but retains direct reads", async () => {
    await db.update(deliveries).set({ archivedAt: READ_ARCHIVE_AT }).where(and(eq(deliveries.organizationId, a.ctx.organizationId), eq(deliveries.id, first.id)));
    expect(await ids(await list())).not.toContain(first.id);
    expect(await ids(await list(`?code=${first.code}`))).toEqual([]);
    for (const id of [first.id, first.code]) expect((await (await get(id)).json()).data.archivedAt).toBe(READ_ARCHIVE_AT.toISOString());
  });

  it("returns 404 for foreign and unknown path and filter ids, with 403 taking precedence", async () => {
    for (const id of [first.id, first.id.toUpperCase(), first.code, UNKNOWN_READ_ID, "missing"]) {
      await lookupProblem(await get(id, b.deliveryKey), 404, "not_found");
    }
    for (const [field, foreign] of [["facilityId", a.facility.id], ["orderId", first.orderId], ["storageLocationId", a.bin.id]]) {
      for (const id of [foreign, foreign.toUpperCase(), UNKNOWN_READ_ID]) await lookupProblem(await list(`?${field}=${id}`, b.deliveryKey), 404, "not_found");
    }
    expect(await ids(await list(`?code=${first.code}`, b.deliveryKey))).toEqual([]);
    for (const key of [a.deliveryWriteKey, a.orderKey, a.missingScopeKey]) {
      await lookupProblem(await list(`?orderId=${UNKNOWN_READ_ID}`, key), 403, "missing_scope");
      for (const id of [first.id, UNKNOWN_READ_ID, "missing"]) await lookupProblem(await get(id, key), 403, "missing_scope");
    }
  });

  it("changes the ETag on update_delivery but keeps it stable on an unrelated order update", async () => {
    const before = await get(first.id);
    const updated = await runOperationInProcess(updateDeliveryOperation, a.ctx, {
      deliveryId: first.id, expectedVersion: first.version, distanceNote: "Route recorded",
    });
    const after = await get(first.id);
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
    expect((await after.json()).data).toEqual(representDelivery({ ...updated, orderCustomerLocationId: a.location.id }));
    const unchanged = await (await get(first.id)).text();
    await db.update(orders).set({ quantityKg: 200, version: 2 }).where(and(eq(orders.organizationId, a.ctx.organizationId), eq(orders.id, first.orderId)));
    const afterOrder = await get(first.id);
    expect(afterOrder.headers.get("etag")).toBe(after.headers.get("etag"));
    expect(await afterOrder.text()).toBe(unchanged);
  });

  it("reads the same row representation returned by posting without including drawn products", async () => {
    await createBiocharProduct(a.ctx, {
      code: `E2E-P-${a.tag}`, facilityId: a.facility.id, formulationId: a.recipe.id,
      placedAt: "2026-09-12T12:00:00.000Z", sourceBiocharStorageLocationId: a.source.id, storageLocationId: a.bin.id,
      massKg: 1000, moistureContentPercent: 10, waterAddedKg: 0, idempotencyKey: randomUUID(),
      composition: { ingredients: [{ formulationIngredientId: a.ingredient.id, feedstockTypeId: a.ingredientType.id, massKg: 200, moistureContentPercent: 60 }] },
    });
    const posted = await runOperationInProcess(recordDelivery, a.ctx, { orderId: first.orderId,
      storageLocationId: a.bin.id, deliveredAt: AT, deliveredWetMassKg: WET_KG, moisturePercent: 20 });
    const response = await get(posted.delivery.id);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(representDelivery({ ...posted.delivery, orderCustomerLocationId: a.location.id }));
    expect(posted.allocations.length).toBeGreaterThan(0);
    await runOperationInProcess(recordDelivery, a.ctx, { orderId: first.orderId,
      storageLocationId: a.bin.id, deliveredAt: LATER, deliveredWetMassKg: WET_KG, moisturePercent: 20 });
    const afterPosting = await get(posted.delivery.id);
    expect(afterPosting.headers.get("etag")).toBe(response.headers.get("etag"));
    expect((await afterPosting.json()).data).toEqual(representDelivery({ ...posted.delivery, orderCustomerLocationId: a.location.id }));
  });
});
