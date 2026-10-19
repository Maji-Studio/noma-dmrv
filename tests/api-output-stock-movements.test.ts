/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";
import { GET } from "@/app/api/v1/storage-locations/[idOrCode]/stock-movements/route";
import { outputStockMovementRepresentationSchema } from "@/lib/representations/output-stock-movements";
import {
  BIOCHAR_DRY_KG, BIOCHAR_WET_KG, createApiProductFixture, expectProblem, FIRST_LOSS_AT, FIRST_LOSS_WET_KG, makePureProduct, postLoss, productApiParams,
  productApiRequest, removeApiProductFixture, SECOND_LOSS_AT, SECOND_LOSS_DRY_KG, SECOND_LOSS_WET_KG, type ApiProductFixture,
} from "./helpers/api-biochar-product-fixture";

const TIMEOUT_MS = 60_000;
const PAGE_LIMIT = 2;
let a: ApiProductFixture;
let b: ApiProductFixture;
let product: Awaited<ReturnType<typeof makePureProduct>>;
const history = (idOrCode: string, query = "", key = a.key) =>
  GET(productApiRequest(`/storage-locations/${encodeURIComponent(idOrCode)}/stock-movements${query}`, key), productApiParams(idOrCode));

/** Posting order on the source bin: a loss, the product's draw, a second loss. Newest is read first. */
beforeEach(async () => {
  a = await createApiProductFixture();
  b = await createApiProductFixture();
  await postLoss(a, FIRST_LOSS_AT, FIRST_LOSS_WET_KG);
  product = await makePureProduct(a);
  await postLoss(a, SECOND_LOSS_AT, SECOND_LOSS_WET_KG);
}, TIMEOUT_MS);
afterEach(async () => { await removeApiProductFixture(a); await removeApiProductFixture(b); }, TIMEOUT_MS);

describe("output bin stock movement history", { timeout: TIMEOUT_MS }, () => {
  it("lists a biochar bin newest posting first with kinds, measurements and links as ids", async () => {
    const response = await history(a.source.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.nextCursor).toBeNull();
    expect(body.data.map((row: { kind: string }) => row.kind)).toEqual(["loss", "production_draw", "loss"]);
    for (const row of body.data) {
      expect(outputStockMovementRepresentationSchema.parse(row)).toEqual(row);
      expect(row.storageLocationId).toBe(a.source.id);
      for (const field of ["createdBy", "actorId", "inputSnapshot", "basisFingerprint", "idempotencyKey", "postingSequence", "organizationId"]) expect(row).not.toHaveProperty(field);
    }
    const [latest, draw, earliest] = body.data;
    expect(latest).toMatchObject({
      occurredAt: SECOND_LOSS_AT, wetMassKg: SECOND_LOSS_WET_KG, moisturePercent: 10, dryDeltaKg: -SECOND_LOSS_DRY_KG, reason: "E2E spilled",
      correctsMovementId: null, correctedByMovementId: null, productionRunIds: [a.r1], biocharProductIds: [], targetBiocharProductId: null, deliveryId: null,
    });
    expect(latest.balanceBeforeDryKg - latest.balanceAfterDryKg).toBe(SECOND_LOSS_DRY_KG);
    expect(draw).toMatchObject({ wetMassKg: BIOCHAR_WET_KG, dryDeltaKg: -BIOCHAR_DRY_KG, productionRunIds: [a.r1], targetBiocharProductId: product.id });
    expect(earliest).toMatchObject({ occurredAt: FIRST_LOSS_AT, wetMassKg: FIRST_LOSS_WET_KG });
    expect(draw.balanceAfterDryKg).toBe(latest.balanceBeforeDryKg);
  });

  it("resolves the bin by id or code and paginates by posting order across pages", async () => {
    const full = (await (await history(a.source.id)).json()).data.map((row: { id: string }) => row.id);
    const first = await (await history(a.source.code, `?limit=${PAGE_LIMIT}`)).json();
    expect(first.data.map((row: { id: string }) => row.id)).toEqual(full.slice(0, PAGE_LIMIT));
    expect(first.nextCursor).toBeTruthy();
    const second = await (await history(a.source.id, `?limit=${PAGE_LIMIT}&cursor=${first.nextCursor}`)).json();
    expect(second.data.map((row: { id: string }) => row.id)).toEqual(full.slice(PAGE_LIMIT));
    expect(second.nextCursor).toBeNull();
    expect(first).not.toHaveProperty("total");
  });

  it("serves a product bin and an unused bin, with no movements of the product bin's own", async () => {
    expect((await (await history(a.pureBin.id)).json()).data).toEqual([]);
    expect((await (await history(a.bin.id)).json()).data).toEqual([]);
  });

  it("keeps the history of an archived bin readable", async () => {
    await db.update(storageLocations).set({ archivedAt: new Date("2026-10-01T00:00:00.000Z") })
      .where(and(eq(storageLocations.id, a.source.id), eq(storageLocations.organizationId, a.ctx.organizationId)));
    const response = await history(a.source.id);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(3);
  });

  it("answers 422 for a feedstock bin, pointing at the bin", async () => {
    const refusal = await expectProblem(await history(a.ingredientBin.id), 422, "validation_failed");
    expect(refusal.errors[0].pointer).toBe("/storageLocationId");
  });

  it("answers 404 for foreign and unknown bins, and refuses cross-bin cursors", async () => {
    for (const identifier of [a.source.id, a.source.code, a.pureBin.id, "missing"]) await expectProblem(await history(identifier, "", b.key), 404, "not_found");
    const page = await (await history(a.source.id, `?limit=${PAGE_LIMIT}`)).json();
    // A foreign key never reaches the cursor: the bin itself is not found.
    await expectProblem(await history(a.source.id, `?limit=${PAGE_LIMIT}&cursor=${page.nextCursor}`, b.key), 404, "not_found");
    await expectProblem(await history(a.pureBin.id, `?cursor=${page.nextCursor}`), 400, "invalid_cursor");
  });

  it("rejects unknown filters and bad limits, and refuses keys without the products scope", async () => {
    for (const query of ["?q=a", "?kind=loss", "?limit=0", "?limit=1&limit=2", "?cursor=bad"]) {
      await expectProblem(await history(a.source.id, query), 400, query === "?cursor=bad" ? "invalid_cursor" : "invalid_query");
    }
    for (const key of [a.otherScopeKey, a.formulationsOnlyKey]) await expectProblem(await history(a.source.id, "", key), 403, "missing_scope");
  });
});
