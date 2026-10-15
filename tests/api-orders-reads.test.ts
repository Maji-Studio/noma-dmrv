/** Real handlers, credentials and Postgres. Not run by the implementation agent. */
import { createOrderDestination } from "./helpers/order-operation-fixture";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, orders } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/orders/route";
import { GET } from "@/app/api/v1/orders/[idOrCode]/route";
import { GET as BALANCE } from "@/app/api/v1/orders/[idOrCode]/balance/route";
import { getOrders } from "@/data-access/orders";
import { archiveFacility } from "@/data-access/facilities";
import { assertDeliveryWithinOrderBalance } from "@/data-access/delivery-order-balance";
import { bodyHashEtag } from "@/lib/api/etag";
import { ORDER_BALANCE_REPRESENTATION_REVISION } from "@/config/api-rest";
import { orderRepresentationSchema } from "@/lib/representations/orders";
import { orderBalanceRepresentationSchema } from "@/lib/representations/order-balance";
import { lookupProblem } from "./helpers/api-lookups";
import { archiveReadOrder, createApiOrderReadFixture, insertReadDelivery, insertReadOrder, readParams, readRequest, removeApiOrderReadFixture,
  READ_ARCHIVE_AT, READ_TIMEOUT_MS, UNKNOWN_READ_ID, type ApiOrderReadFixture } from "./helpers/api-order-read-fixture";

const PAGE_LIMIT = 1;
const PARTIAL_KG = 25;
const REMAINDER_KG = 75;
let a: ApiOrderReadFixture;
let b: ApiOrderReadFixture;
let first: Awaited<ReturnType<typeof insertReadOrder>>;
let second: typeof first;
let other: typeof first;
const list = (query = "", key = a.key) => LIST(readRequest(`/orders${query}`, key));
const get = (identifier: string, key = a.key, query = "") => GET(readRequest(`/orders/${encodeURIComponent(identifier)}${query}`, key), readParams(identifier));
const balance = (identifier: string, key = a.key, query = "") => BALANCE(readRequest(`/orders/${encodeURIComponent(identifier)}/balance${query}`, key), readParams(identifier));
const ids = async (response: Response): Promise<string[]> => (await response.json()).data.map((row: { id: string }) => row.id);

beforeEach(async () => {
  a = await createApiOrderReadFixture(); b = await createApiOrderReadFixture();
  first = await insertReadOrder(a, `OR-READ-1-${a.tag}`, { createdAt: sql`'2026-10-01 12:00:00.123455'::timestamp` });
  second = await insertReadOrder(a, `OR-READ-2-${a.tag}`, { createdAt: sql`'2026-10-01 12:00:00.123456'::timestamp`, orderDate: new Date("2026-09-13T00:00:00Z"), customerLocationId: a.location.id, packaging: "bagged" });
  other = await insertReadOrder(a, `OR-READ-3-${a.tag}`, { createdAt: new Date("2026-10-02T00:00:00Z"), customerId: a.otherCustomer.id, customerLocationId: (await createOrderDestination(a, a.otherCustomer.id)).id, formulationId: a.pure.id, facilityId: a.otherFacility.id, orderDate: new Date("2026-08-12T00:00:00Z") });
}, READ_TIMEOUT_MS);
afterEach(async () => { await removeApiOrderReadFixture(a); await removeApiOrderReadFixture(b); }, READ_TIMEOUT_MS);

describe("order REST reads", { timeout: READ_TIMEOUT_MS }, () => {
  it("gets stored fields by id or code with a strong ETag, calendar date and no joins or balance", async () => {
    for (const identifier of [first.id, first.code, first.id.toUpperCase()]) {
      const response = await get(identifier);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(`"${first.version}.1"`);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const { data } = await response.json();
      expect(orderRepresentationSchema.parse(data)).toEqual(data);
      expect(Object.keys(data).sort()).toEqual(Object.keys(orderRepresentationSchema.shape).sort());
      expect(data).toMatchObject({ id: first.id, facilityId: a.facility.id, customerId: a.customer.id, customerLocationId: a.location.id,
        formulationId: a.recipe.id, orderDate: "2026-09-12", quantityKg: 100, packaging: "loose", archivedAt: null });
    }
    expect((await (await get(second.id)).json()).data).toMatchObject({ customerLocationId: a.location.id, packaging: "bagged", orderDate: "2026-09-13" });
    expect(await (await get(first.id)).text()).toBe(await (await get(first.code)).text());
  });

  it("publishes the stored real quantity without claiming the input's lost precision", async () => {
    const quantity = 20000.001;
    const row = await insertReadOrder(a, `OR-PRECISION-${a.tag}`, { quantityKg: quantity });
    expect(row.quantityKg).not.toBe(quantity);
    expect((await (await get(row.id)).json()).data.quantityKg).toBe(row.quantityKg);
    expect((await (await balance(row.id)).json()).data.quantityKg).toBe(row.quantityKg);
  });

  it("pages newest first with microseconds, UUID ties, bound filters and no totals", async () => {
    const tied = await insertReadOrder(a, `OR-TIE-${a.tag}`, { createdAt: sql`'2026-10-01 12:00:00.123456'::timestamp` });
    const expected = [other.id, ...[second.id, tied.id].sort().reverse(), first.id];
    expect(await ids(await list())).toEqual(expected);
    let query = `?limit=${PAGE_LIMIT}`;
    const seen: string[] = [];
    const page = await (await list(query)).json();
    expect(page).not.toHaveProperty("total");
    await lookupProblem(await list(`?customerId=${a.customer.id}&cursor=${page.nextCursor}`), 400, "invalid_cursor");
    await lookupProblem(await list(`?cursor=${page.nextCursor}`, b.key), 400, "invalid_cursor");
    while (true) {
      const page = await (await list(query)).json();
      seen.push(...page.data.map((row: { id: string }) => row.id));
      if (!page.nextCursor) break;
      query = `?limit=${PAGE_LIMIT}&cursor=${page.nextCursor}`;
    }
    expect(seen).toEqual(expected);
  });

  it("filters on every published field, with inclusive from and exclusive before dates", async () => {
    for (const [name, value] of [["facilityId", a.facility.id], ["customerId", a.customer.id], ["formulationId", a.recipe.id]]) {
      expect(await ids(await list(`?${name}=${value.toUpperCase()}`))).toEqual([second.id, first.id]);
    }
    expect(await ids(await list(`?code=${first.code}`))).toEqual([first.id]);
    expect(await ids(await list("?q=or-read-1"))).toEqual([first.id]);
    expect(await ids(await list("?q=%25"))).toEqual([]);
    expect(await ids(await list("?orderedFrom=2026-09-12&orderedBefore=2026-09-13"))).toEqual([first.id]);
    expect(await ids(await list("?orderedFrom=2026-09-13"))).toEqual([second.id]);
    expect(await ids(await list("?orderedBefore=2026-09-12"))).toEqual([other.id]);
    const page = await (await list(`?customerId=${a.customer.id}&limit=${PAGE_LIMIT}`)).json();
    expect(await ids(await list(`?customerId=${a.customer.id.toUpperCase()}&cursor=${page.nextCursor}`))).toEqual([first.id]);
    for (const query of ["?unknown=1", "?orderedFrom=2026-02-29", "?orderedBefore=2026-09-12T00:00:00Z", "?customerId=bad", "?limit=1&limit=2"]) {
      await lookupProblem(await list(query), 400, "invalid_query");
    }
    await lookupProblem(await get(first.id, a.key, "?q=x"), 400, "invalid_query");
    await lookupProblem(await balance(first.id, a.key, "?facilityId=" + a.facility.id), 400, "invalid_query");
  });

  it("accepts early calendar dates and rejects impossible leap days in both bounds", async () => {
    for (const date of ["0020-02-29", "0001-01-01", "2000-02-29"]) {
      const response = await list(`?orderedFrom=${date}&orderedBefore=${date}`);
      expect(response.status).toBe(200);
      expect(await ids(response)).toEqual([]);
    }
    for (const field of ["orderedFrom", "orderedBefore"]) {
      for (const date of ["0021-02-29", "1900-02-29"]) {
        await lookupProblem(await list(`?${field}=${date}`), 400, "invalid_query");
      }
    }
  });

  it("hides archived orders from lists but serves direct and balance reads", async () => {
    await archiveReadOrder(a, first.id);
    expect(await ids(await list())).toEqual([other.id, second.id]);
    expect(await ids(await list(`?code=${first.code}`))).toEqual([]);
    for (const identifier of [first.id, first.code]) {
      expect((await (await get(identifier)).json()).data.archivedAt).toBe(READ_ARCHIVE_AT.toISOString());
      expect((await balance(identifier)).status).toBe(200);
    }
  });

  it("answers 404 for foreign and unknown paths and reference filters, after checking scope", async () => {
    for (const identifier of [first.id, first.id.toUpperCase(), first.code, UNKNOWN_READ_ID, "missing"]) {
      for (const read of [get, balance]) await lookupProblem(await read(identifier, b.key), 404, "not_found");
    }
    for (const [name, foreign] of [["facilityId", a.facility.id], ["customerId", a.customer.id], ["formulationId", a.recipe.id]]) {
      for (const id of [foreign, foreign.toUpperCase(), UNKNOWN_READ_ID]) {
        const refusal = await lookupProblem(await list(`?${name}=${id}`, b.key), 404, "not_found");
        expect(refusal.errors[0].pointer).toBe(`/${name}`);
      }
    }
    expect(await ids(await list(`?code=${first.code}`, b.key))).toEqual([]);
    for (const key of [a.missingScopeKey, a.writeOnlyKey, a.customerKey]) {
      await lookupProblem(await list("", key), 403, "missing_scope");
      await lookupProblem(await list(`?customerId=${b.customer.id}`, key), 403, "missing_scope");
      for (const identifier of [first.id, b.customer.id, "missing"]) {
        await lookupProblem(await get(identifier, key), 403, "missing_scope");
        await lookupProblem(await balance(identifier, key), 403, "missing_scope");
      }
    }
    expect((await list("", a.orderKey)).status).toBe(200);
  });
});

describe("order balance REST snapshot", { timeout: READ_TIMEOUT_MS }, () => {
  it("serves no deliveries, partial and exact fulfillment, changing only the balance ETag on a delivery", async () => {
    const orderTag = (await get(first.id)).headers.get("etag");
    const initial = await balance(first.id);
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toBe("private, no-store");
    expect((await initial.json()).data).toEqual({ orderId: first.id, quantityKg: 100, deliveredWetMassKg: 0, remainingWetMassKg: 100, fulfillmentStatus: "no_deliveries" });
    await insertReadDelivery(a, first.id, PARTIAL_KG);
    const partial = await balance(first.code);
    const { data } = await partial.json();
    expect(orderBalanceRepresentationSchema.parse(data)).toEqual(data);
    expect(data).toEqual({ orderId: first.id, quantityKg: 100, deliveredWetMassKg: PARTIAL_KG, remainingWetMassKg: REMAINDER_KG, fulfillmentStatus: "partial" });
    expect(partial.headers.get("etag")).toBe(bodyHashEtag(ORDER_BALANCE_REPRESENTATION_REVISION, data));
    expect(partial.headers.get("etag")).not.toBe(initial.headers.get("etag"));
    expect((await get(first.id)).headers.get("etag")).toBe(orderTag);
    expect((await balance(first.id.toUpperCase())).headers.get("etag")).toBe(partial.headers.get("etag"));
    await insertReadDelivery(a, first.id, REMAINDER_KG);
    const exact = await balance(first.id);
    expect((await exact.json()).data).toMatchObject({ deliveredWetMassKg: 100, remainingWetMassKg: 0, fulfillmentStatus: "fulfilled" });
    expect(exact.headers.get("etag")).not.toBe(partial.headers.get("etag"));
    expect((await get(first.id)).headers.get("etag")).toBe(orderTag);
  });

  it("retains delivered mass when the facility cascade archives the order and its deliveries together", async () => {
    const delivery = await insertReadDelivery(a, first.id, PARTIAL_KG);
    const live = await balance(first.id);
    const liveData = (await live.json()).data;
    expect(liveData).toMatchObject({ deliveredWetMassKg: PARTIAL_KG, remainingWetMassKg: REMAINDER_KG, fulfillmentStatus: "partial" });
    const facility = await archiveFacility(a.ctx, a.facility.id, a.facility.version);
    const [archivedDelivery] = await db.select({ archivedAt: deliveries.archivedAt }).from(deliveries)
      .where(and(eq(deliveries.organizationId, a.ctx.organizationId), eq(deliveries.id, delivery.id)));
    expect(archivedDelivery.archivedAt).toEqual(facility.archivedAt);
    expect((await (await get(first.id)).json()).data.archivedAt).toBe(facility.archivedAt!.toISOString());
    const archived = await balance(first.id);
    expect((await archived.json()).data).toEqual(liveData);
    expect(archived.headers.get("etag")).toBe(live.headers.get("etag"));
  });

  it("publishes a decimal remainder that the delivery writer accepts exactly", async () => {
    const quantityKg = 1234.5;
    const deliveredKg = 1000.1;
    const row = await insertReadOrder(a, `OR-REMAINDER-${a.tag}`, { quantityKg });
    await insertReadDelivery(a, row.id, deliveredKg);
    const { data } = await (await balance(row.id)).json();
    expect(data).toMatchObject({ deliveredWetMassKg: deliveredKg, remainingWetMassKg: 234.4 });
    await expect(db.transaction((tx) => assertDeliveryWithinOrderBalance(a.ctx, tx, {
      orderId: row.id, orderQuantityKg: row.quantityKg, requestedWetKg: data.remainingWetMassKg,
    }))).resolves.toBeUndefined();
    await insertReadDelivery(a, row.id, data.remainingWetMassKg);
    expect((await (await balance(row.id)).json()).data).toMatchObject({ deliveredWetMassKg: quantityKg, remainingWetMassKg: 0, fulfillmentStatus: "fulfilled" });
  });

  it("matches the app fulfillment at the stored real-to-numeric boundary", async () => {
    const row = await insertReadOrder(a, `OR-BOUNDARY-${a.tag}`, { quantityKg: 10000.001 });
    await insertReadDelivery(a, row.id, 9800);
    const api = (await (await balance(row.id)).json()).data;
    const app = (await getOrders(a.ctx)).items.find((item) => item.id === row.id)!;
    expect(api.fulfillmentStatus).toBe(app.fulfillmentStatus);
  });

  it("retains the 98% fulfillment threshold while reporting the actual remaining mass", async () => {
    await insertReadDelivery(a, first.id, 98);
    expect((await (await balance(first.id)).json()).data).toMatchObject({ deliveredWetMassKg: 98, remainingWetMassKg: 2, fulfillmentStatus: "fulfilled" });
    // Historical over-allocation is clamped, never a negative remaining mass.
    await db.update(orders).set({ quantityKg: PARTIAL_KG }).where(and(eq(orders.organizationId, a.ctx.organizationId), eq(orders.id, first.id)));
    expect((await (await balance(first.id)).json()).data).toMatchObject({ remainingWetMassKg: 0, fulfillmentStatus: "fulfilled" });
  });
});
