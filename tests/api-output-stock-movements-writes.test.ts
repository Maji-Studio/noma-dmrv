/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";
import { GET as HISTORY, POST } from "@/app/api/v1/storage-locations/[idOrCode]/stock-movements/route";
import { outputStockMovementRepresentationSchema } from "@/lib/representations/output-stock-movements";
import {
  BIOCHAR_MOISTURE_PERCENT, createApiProductFixture, expectProblem, productApiParams, productApiRequest,
  removeApiProductFixture, type ApiProductFixture,
} from "./helpers/api-biochar-product-fixture";
import {
  captureProductWriteState, countBody, FUTURE_AT, lossBody, postMovementRest, postProductRest, productWriteAudits, pureProductBody,
  WRITE_LOSS_AT, WRITE_LOSS_WET_KG, writeIdempotencyRecords,
} from "./helpers/api-biochar-write-fixture";

const TIMEOUT_MS = 60_000;
const SOURCE_DRY_KG = 1500;
const LOSS_DRY_KG = 90;
const OVERSIZED_WET_KG = 5000;
const OVERSIZED_DRY_KG = 4500;
const COUNTED_WET_KG = 1000;
const COUNTED_DRY_KG = 900;
let a: ApiProductFixture;
let b: ApiProductFixture;
beforeEach(async () => {
  a = await createApiProductFixture();
  b = await createApiProductFixture();
}, TIMEOUT_MS);
afterEach(async () => { await removeApiProductFixture(a); await removeApiProductFixture(b); }, TIMEOUT_MS);

const noChange = async () => {
  const state = await captureProductWriteState(a);
  expect(state.movements).toEqual([]);
  expect(await productWriteAudits(a, "movement")).toEqual([]);
};

describe("output bin stock movement writes", { timeout: TIMEOUT_MS }, () => {
  it("records a loss with the movement representation, no ETag or Location, one draw and one audit row", async () => {
    const response = await postMovementRest(a, a.source.id, lossBody());
    expect(response.status).toBe(201);
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.has("location")).toBe(false);
    const { data, ...rest } = await response.json();
    expect(rest).toEqual({});
    expect(outputStockMovementRepresentationSchema.parse(data)).toEqual(data);
    expect(data).toMatchObject({
      storageLocationId: a.source.id, kind: "loss", occurredAt: WRITE_LOSS_AT, wetMassKg: WRITE_LOSS_WET_KG, moisturePercent: BIOCHAR_MOISTURE_PERCENT,
      dryDeltaKg: -LOSS_DRY_KG, balanceBeforeDryKg: SOURCE_DRY_KG, balanceAfterDryKg: SOURCE_DRY_KG - LOSS_DRY_KG,
      reason: "E2E REST loss", correctsMovementId: null, correctedByMovementId: null, productionRunIds: [a.r1],
    });
    for (const field of ["idempotencyKey", "basisFingerprint", "inputSnapshot", "postingSequence", "organizationId"]) expect(data).not.toHaveProperty(field);
    const history = await (await HISTORY(productApiRequest(`/storage-locations/${a.source.id}/stock-movements`, a.key), productApiParams(a.source.id))).json();
    expect(history.data[0]).toEqual(data);
    expect((await captureProductWriteState(a)).movements).toMatchObject([{ id: data.id, outputKind: "loss", storageLocationId: a.source.id }]);
    expect(await productWriteAudits(a, "movement")).toMatchObject([{
      operationId: "record_output_stock_movement", action: "created", source: "rest", credentialId: a.writeCredentialId,
      entityId: data.id, versionBefore: null, versionAfter: null,
    }]);
    expect((await productWriteAudits(a, "movement"))[0].changedFields).not.toContain("basisFingerprint");
  });

  it("canonicalizes an uppercase bin UUID, so either case replays one key (api/uuid-case)", async () => {
    const key = randomUUID();
    const upper = await postMovementRest(a, a.source.id.toUpperCase(), lossBody(), key);
    expect(upper.status).toBe(201);
    const text = await upper.text();
    expect(JSON.parse(text).data).toMatchObject({ storageLocationId: a.source.id, kind: "loss", productionRunIds: [a.r1] });
    const lower = await postMovementRest(a, a.source.id, lossBody(), key);
    expect(lower.status).toBe(201);
    expect(lower.headers.get("idempotent-replayed")).toBe("true");
    expect(await lower.text()).toBe(text);
    expect((await captureProductWriteState(a)).movements).toHaveLength(1);
    expect(await productWriteAudits(a, "movement")).toHaveLength(1);
  });

  it("records a count that resets the bin to the counted stock and a count of zero that empties it", async () => {
    const counted = await postMovementRest(a, a.source.id, countBody(COUNTED_WET_KG));
    expect(counted.status).toBe(201);
    expect((await counted.json()).data).toMatchObject({
      kind: "count", wetMassKg: COUNTED_WET_KG, balanceBeforeDryKg: SOURCE_DRY_KG, balanceAfterDryKg: COUNTED_DRY_KG, dryDeltaKg: COUNTED_DRY_KG - SOURCE_DRY_KG,
    });
    const emptied = await postMovementRest(a, a.source.id, countBody(0, { moisturePercent: undefined }));
    expect(emptied.status).toBe(201);
    expect((await emptied.json()).data).toMatchObject({ kind: "count", wetMassKg: 0, balanceAfterDryKg: 0 });
  });

  it("previews with stockEffects and a basis fingerprint, needs a key, persists nothing and consumes no key", async () => {
    await expectProblem(await postMovementRest(a, a.source.id, lossBody(), null, "?dryRun=true"), 400, "idempotency_key_required");
    const key = randomUUID();
    const preview = await postMovementRest(a, a.source.id, lossBody(), key, "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    const body = await preview.json();
    expect(body.basisFingerprint).toEqual(expect.any(String));
    expect(body.data).toMatchObject({ kind: "loss", dryDeltaKg: -LOSS_DRY_KG });
    expect(body.stockEffects).toContainEqual(expect.objectContaining({
      storageLocationId: a.source.id, stockKind: "biochar_bin", delta: expect.objectContaining({ dryKg: -LOSS_DRY_KG }),
    }));
    await noChange();
    expect(await writeIdempotencyRecords(a)).toEqual([]);
    expect((await postMovementRest(a, a.source.id, lossBody(), key)).status).toBe(201);
  });

  it("replays the same key and body once, and refuses the key with a different body", async () => {
    const key = randomUUID();
    const first = await postMovementRest(a, a.source.id, lossBody(), key);
    const text = await first.text();
    const replay = await postMovementRest(a, a.source.id, lossBody(), key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.text()).toBe(text);
    await expectProblem(await postMovementRest(a, a.source.id, lossBody({ wetMassKg: 1 }), key), 422, "idempotency_key_reused");
    expect((await captureProductWriteState(a)).movements).toHaveLength(1);
    expect(await productWriteAudits(a, "movement")).toHaveLength(1);
  });

  it("refuses a feedstock bin with 422 on /storageLocationId", async () => {
    const refusal = await expectProblem(await postMovementRest(a, a.ingredientBin.id, lossBody()), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/storageLocationId" }));
    await noChange();
  });

  it("answers 404 on /storageLocationId for an unknown, foreign, archived or code-addressed bin", async () => {
    await db.update(storageLocations).set({ archivedAt: new Date() }).where(and(eq(storageLocations.organizationId, a.ctx.organizationId), eq(storageLocations.id, a.bin.id)));
    for (const id of [randomUUID(), b.source.id, a.bin.id, a.source.code]) {
      const refusal = await expectProblem(await postMovementRest(a, id, lossBody()), 404, "not_found");
      expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/storageLocationId" }));
      expect(JSON.stringify(refusal)).not.toContain(b.source.code);
    }
    await noChange();
    expect((await captureProductWriteState(b)).movements).toEqual([]);
  });

  it.each([
    ["correctsMovementId", { correctsMovementId: randomUUID() }],
    ["storageLocationId", { storageLocationId: randomUUID() }],
    ["expectedProductVersions", { expectedProductVersions: {} }],
    ["idempotencyKey", { idempotencyKey: "client-key" }],
    ["facilityId", { facilityId: randomUUID() }],
  ])("rejects %s as an unknown key", async (key, extra) => {
    const refusal = await expectProblem(await postMovementRest(a, a.source.id, lossBody(extra)), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: `/${key}`, code: "unknown_field" }));
    await noChange();
  });

  it.each([
    ["a delivery kind", lossBody({ kind: "delivery" }), "/kind"],
    ["sources on a count", countBody(COUNTED_WET_KG, { sources: [{ layerId: randomUUID(), moisturePercent: BIOCHAR_MOISTURE_PERCENT }] }), "/sources"],
    ["a missing reason", lossBody({ reason: " " }), "/reason"],
    ["a missing moisture", lossBody({ moisturePercent: undefined }), "/moisturePercent"],
    ["a zero loss", lossBody({ wetMassKg: 0 }), "/wetMassKg"],
    ["an occurrence in the future", lossBody({ occurredAt: FUTURE_AT }), "/occurredAt"],
    ["an occurrence without an offset", lossBody({ occurredAt: "2026-09-14T12:00:00" }), "/occurredAt"],
  ])("answers 422 for %s", async (_name, body, pointer) => {
    const refusal = await expectProblem(await postMovementRest(a, a.source.id, body), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer }));
    await noChange();
  });

  it("answers 409 insufficient_stock with the typed meta and posts nothing", async () => {
    const refusal = await expectProblem(await postMovementRest(a, a.source.id, lossBody({ wetMassKg: OVERSIZED_WET_KG })), 409, "insufficient_stock");
    expect(refusal.errors).toContainEqual(expect.objectContaining({
      pointer: "/wetMassKg", code: "insufficient_stock",
      meta: { storageLocationId: a.source.id, measure: "dry_biochar", availableSolidsKg: SOURCE_DRY_KG, requestedSolidsKg: OVERSIZED_DRY_KG, unit: "kg" },
    }));
    await noChange();
  });

  it("posts on a product bin and keeps the product bin's own history readable", async () => {
    const created = await postProductRest(a, pureProductBody(a));
    expect(created.status).toBe(201);
    const loss = await postMovementRest(a, a.pureBin.id, lossBody({ wetMassKg: 50 }));
    expect(loss.status).toBe(201);
    expect((await loss.json()).data).toMatchObject({ storageLocationId: a.pureBin.id, kind: "loss", wetMassKg: 50 });
  });

  it("refuses each write without the write scope", async () => {
    for (const key of [a.key, a.otherScopeKey]) {
      const request = new Request(`http://localhost:3100/api/v1/storage-locations/${a.source.id}/stock-movements`, {
        method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(lossBody()),
      });
      await expectProblem(await POST(request, productApiParams(a.source.id)), 403, "missing_scope");
    }
    await noChange();
  });
});
