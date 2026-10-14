/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { BIOCHAR_PRODUCT_REPRESENTATION_REVISION } from "@/config/api-rest";
import { archiveFacility } from "@/data-access/facilities";
import { createDelivery } from "@/data-access/delivery-output-writes";
import { createOrderInTransaction } from "@/data-access/orders";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { createApiProductFixture, expectProblem, removeApiProductFixture, BIOCHAR_MOISTURE_PERCENT, type ApiProductFixture } from "./helpers/api-biochar-product-fixture";
import {
  countBody, lossBody, patchProductRest, postMovementRest, readRestProduct, seedRestProduct,
} from "./helpers/api-biochar-write-fixture";

const TIMEOUT_MS = 60_000;
const PRODUCT_LOSS_WET_KG = 50;
const PRODUCT_COUNT_WET_KG = 300;
const DELIVERY_WET_KG = 100;
const STOCK_TIME = "2026-09-14T12:00:00.000Z";
const ORDER_DATE = "2026-09-14";
const ORDER_QUANTITY_KG = 1000;
let f: ApiProductFixture;
beforeEach(async () => { f = await createApiProductFixture(); }, TIMEOUT_MS);
afterEach(async () => { await removeApiProductFixture(f); });
const etagAt = (version: number) => `"${version}.${BIOCHAR_PRODUCT_REPRESENTATION_REVISION}"`;

async function deliverFromProductBin() {
  const order = await db.transaction(tx => createOrderInTransaction(f.ctx, tx, { code: `E2E-API-O-${f.tag}`, facilityId: f.facility.id, customerId: f.customer.id,
    formulationId: f.pure.id, orderDate: new Date(ORDER_DATE), quantityKg: ORDER_QUANTITY_KG, packaging: "loose" }));
  const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.pureBin.id, occurredAt: STOCK_TIME,
    kind: "delivery", wetMassKg: DELIVERY_WET_KG, moisturePercent: BIOCHAR_MOISTURE_PERCENT });
  return createDelivery(f.ctx, { code: `E2E-API-D-${f.tag}`, facilityId: f.facility.id, orderId: order.id, storageLocationId: f.pureBin.id,
    deliveryDate: new Date(STOCK_TIME), deliveredWetMassKg: DELIVERY_WET_KG, moistureContentPercent: BIOCHAR_MOISTURE_PERCENT,
    idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint });
}

describe("biochar product version cascades", { timeout: TIMEOUT_MS }, () => {
  it.each([
    ["a loss on the product bin", async () => expect((await postMovementRest(f, f.pureBin.id, lossBody({ wetMassKg: PRODUCT_LOSS_WET_KG }))).status).toBe(201)],
    ["a count on the product bin", async () => expect((await postMovementRest(f, f.pureBin.id, countBody(PRODUCT_COUNT_WET_KG))).status).toBe(201)],
    ["a delivery from the product bin", async () => { await deliverFromProductBin(); }],
  ])("%s bumps the product version and ETag, and its old If-Match is stale", async (_name, writer) => {
    const saved = await seedRestProduct(f);
    expect(saved.etag).toBe(etagAt(saved.row.version));
    await writer();
    const current = await readRestProduct(f, saved.row.id);
    expect(current.row.version).toBe(saved.row.version + 1);
    expect(current.etag).toBe(etagAt(current.row.version));
    const refusal = await expectProblem(await patchProductRest(f, saved.row.id, { status: "ready" }, saved.etag), 412, "stale_version");
    expect(refusal.current).toEqual(current.row);
    expect((await readRestProduct(f, saved.row.id)).row.status).toBe(saved.row.status);
  });

  it("a PATCH bumps the version once and invalidates its own tag", async () => {
    const saved = await seedRestProduct(f);
    expect((await patchProductRest(f, saved.row.id, { status: "ready" }, saved.etag)).status).toBe(200);
    const current = await readRestProduct(f, saved.row.id);
    expect(current.row.version).toBe(saved.row.version + 1);
    await expectProblem(await patchProductRest(f, saved.row.id, { status: "sold" }, saved.etag), 412, "stale_version");
  });

  it("a facility archive bumps the product version and ETag and keeps the product readable", async () => {
    const saved = await seedRestProduct(f);
    const [facility] = await db.select({ version: facilities.version }).from(facilities).where(and(eq(facilities.organizationId, f.ctx.organizationId), eq(facilities.id, f.facility.id)));
    await archiveFacility(f.ctx, f.facility.id, facility.version);
    const current = await readRestProduct(f, saved.row.id);
    expect(current.row.version).toBe(saved.row.version + 1);
    expect(current.row.archivedAt).not.toBeNull();
    expect(current.etag).not.toBe(saved.etag);
  });

  it("a loss on the biochar bin the product was drawn from leaves the product ETag unchanged", async () => {
    const saved = await seedRestProduct(f);
    expect((await postMovementRest(f, f.source.id, lossBody())).status).toBe(201);
    expect(await readRestProduct(f, saved.row.id)).toEqual(saved);
  });
});
