/** Real MCP route, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKey } from "@/data-access/api-keys";
import { POST as MCP } from "@/app/api/mcp/route";
import { GET as GET_PRODUCTS } from "@/app/api/v1/biochar-products/route";
import { GET as GET_FORMULATIONS } from "@/app/api/v1/formulations/route";
import { GET as GET_MOVEMENTS } from "@/app/api/v1/storage-locations/[idOrCode]/stock-movements/route";
import type { ApiScope } from "@/lib/auth/api-scopes";
import {
  createApiProductFixture, FIRST_LOSS_AT, FIRST_PLACED_AT, productApiParams, productApiRequest, removeApiProductFixture, type ApiProductFixture,
} from "./helpers/api-biochar-product-fixture";
import {
  captureProductWriteState, lossBody, countBody, postMovementRest, postProductRest, productWriteAudits, pureProductBody, blendedProductBody,
  seedRestProduct, writeIdempotencyRecords, FUTURE_AT,
} from "./helpers/api-biochar-write-fixture";
import { rpc, rpcBody } from "./helpers/mcp";
import { uppercaseUuids } from "./helpers/uppercase-uuids";

const switches = vi.hoisted(() => ({ writesDisabled: false }));
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, get API_WRITES_DISABLED() { return switches.writesDisabled; } } };
});

const TIMEOUT_MS = 60_000;
const OVERSIZED_WET_KG = 5000;
const WRITE_TOOLS = ["make_biochar_product", "update_biochar_product", "record_output_stock_movement"];
const READ_TOOLS = ["find_biochar_products", "get_biochar_product", "find_output_stock_movements"];
let a: ApiProductFixture;
let b: ApiProductFixture;
beforeEach(async () => {
  a = await createApiProductFixture();
  b = await createApiProductFixture();
}, TIMEOUT_MS);
afterEach(async () => {
  switches.writesDisabled = false;
  await removeApiProductFixture(a);
  await removeApiProductFixture(b);
}, TIMEOUT_MS);

async function call(name: string, args: Record<string, unknown> = {}, key = a.writeKey) {
  const response = await MCP(rpc(key, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}
const write = (name: string, args: Record<string, unknown>, key = a.writeKey) => call(name, { requestKey: randomUUID(), ...args }, key);
const movementArgs = (body: Record<string, unknown> = lossBody(), binId = a.source.id) => ({ storageLocationId: binId, ...body });
async function toolsFor(scopes: ApiScope[]) {
  const { key } = await createApiKey(a.ctx, { name: `Scoped ${scopes.join(",")}`, scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
  return (await rpcBody(await MCP(rpc(key, "tools/list")))).result.tools.map((tool: { name: string }) => tool.name) as string[];
}
const noChange = async () => {
  const state = await captureProductWriteState(a);
  expect(state.products).toEqual([]);
  expect(state.movements).toEqual([]);
  expect(await productWriteAudits(a)).toEqual([]);
};

describe("biochar product MCP tools", { timeout: TIMEOUT_MS }, () => {
  it("lists tools by scope: write-only, read-only and formulations-only keys", async () => {
    const writeOnly = await toolsFor(["biochar-products:write"]);
    for (const name of WRITE_TOOLS) expect(writeOnly).toContain(name);
    for (const name of [...READ_TOOLS, "find_formulations"]) expect(writeOnly).not.toContain(name);
    const readOnly = await toolsFor(["biochar-products:read"]);
    for (const name of READ_TOOLS) expect(readOnly).toContain(name);
    for (const name of [...WRITE_TOOLS, "find_formulations"]) expect(readOnly).not.toContain(name);
    const formulationsOnly = await toolsFor(["formulations:read"]);
    expect(formulationsOnly).toContain("find_formulations");
    for (const name of [...WRITE_TOOLS, ...READ_TOOLS]) expect(formulationsOnly).not.toContain(name);
    const { result } = await rpcBody(await MCP(rpc(a.writeKey, "tools/list")));
    const tools: { name: string; annotations: Record<string, boolean>; description: string; inputSchema: { properties: Record<string, unknown> } }[] = result.tools;
    expect(tools.find((tool) => tool.name === "update_biochar_product")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(tools.find((tool) => tool.name === "make_biochar_product")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    const movement = tools.find((tool) => tool.name === "record_output_stock_movement")!;
    expect(movement.inputSchema.properties).not.toHaveProperty("correctsMovementId");
    expect(movement.description).toContain("Corrections are not available");
    expect(tools.some((tool) => /delete_biochar_product|correct/.test(tool.name))).toBe(false);
  });

  it("makes a product with the REST 201 body, previews it key-free, and audits it as mcp", async () => {
    const preview = await call("make_biochar_product", { ...pureProductBody(a), dryRun: true });
    expect(preview.isError).toBeUndefined();
    expect(preview.structuredContent.basisFingerprint).toEqual(expect.any(String));
    expect(preview.structuredContent.stockEffects).toContainEqual(expect.objectContaining({ storageLocationId: a.source.id, stockKind: "biochar_bin" }));
    expect(preview.content[0].text).toMatch(/^Dry run: would make biochar product/);
    await noChange();
    const made = await write("make_biochar_product", pureProductBody(a));
    expect(made.isError).toBeUndefined();
    expect(made.structuredContent).toEqual({ data: expect.objectContaining({ version: 1, status: "testing", facilityId: a.facility.id, placedAt: FIRST_PLACED_AT }) });
    const state = await captureProductWriteState(a);
    expect(state.products).toHaveLength(1);
    expect(state.movements).toHaveLength(1);
    expect(await productWriteAudits(a)).toMatchObject([{ operationId: "make_biochar_product", source: "mcp", credentialId: a.writeCredentialId, versionAfter: 1 }]);
  });

  it("makes a blend from the parts as weighed", async () => {
    const made = await write("make_biochar_product", blendedProductBody(a));
    expect(made.structuredContent.data).toMatchObject({ formulationId: a.recipe.id, ingredients: [expect.objectContaining({ formulationIngredientId: a.ingredient.id })] });
  });

  it("updates code, status and density by version and returns the current record when stale", async () => {
    const seeded = (await write("make_biochar_product", pureProductBody(a))).structuredContent.data;
    const preview = await call("update_biochar_product", { biocharProductId: seeded.id, expectedVersion: seeded.version, status: "ready", dryRun: true });
    expect(preview.structuredContent.data).toMatchObject({ status: "ready" });
    expect((await call("get_biochar_product", { idOrCode: seeded.id })).structuredContent.data.status).toBe("testing");
    const updated = await write("update_biochar_product", { biocharProductId: seeded.id, expectedVersion: seeded.version, status: "ready", densityKgM3: 250 });
    expect(updated.structuredContent.data).toMatchObject({ version: 2, status: "ready", densityKgM3: 250 });
    const stale = await write("update_biochar_product", { biocharProductId: seeded.id, expectedVersion: seeded.version, status: "sold" });
    expect(stale).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current: updated.structuredContent.data } });
    const refused = await write("update_biochar_product", { biocharProductId: seeded.id, expectedVersion: 2, massKg: 1 });
    expect(refused.isError).toBe(true);
    expect(await productWriteAudits(a)).toMatchObject([{ source: "mcp" }, { source: "mcp" }]);
  });

  it("records a loss and a count, previews them key-free and audits them as mcp", async () => {
    const preview = await call("record_output_stock_movement", { ...movementArgs(), dryRun: true });
    expect(preview.structuredContent.basisFingerprint).toEqual(expect.any(String));
    expect(preview.content[0].text).toMatch(/^Dry run: would record a loss/);
    await noChange();
    const loss = await write("record_output_stock_movement", movementArgs());
    expect(loss.structuredContent.data).toMatchObject({ kind: "loss", storageLocationId: a.source.id });
    expect(loss.structuredContent).not.toHaveProperty("basisFingerprint");
    const count = await write("record_output_stock_movement", movementArgs(countBody(0)));
    expect(count.structuredContent.data).toMatchObject({ kind: "count", wetMassKg: 0 });
    expect(await productWriteAudits(a, "movement")).toMatchObject([{ source: "mcp" }, { source: "mcp" }]);
    const history = await call("find_output_stock_movements", { idOrCode: a.source.code }, a.key);
    expect(history.structuredContent.data.map((row: { kind: string }) => row.kind)).toEqual(expect.arrayContaining(["count", "loss"]));
  });

  it("rejects corrections, delivery kind and UI-only fields", async () => {
    for (const extra of [{ correctsMovementId: randomUUID() }, { kind: "delivery" }, { expectedProductVersions: {} }, { idempotencyKey: "form" }]) {
      const refusal = await write("record_output_stock_movement", movementArgs(lossBody(extra)));
      expect(refusal.isError).toBe(true);
      expect(refusal.structuredContent.code).toBe("validation_failed");
    }
    await noChange();
  });

  it("requires a requestKey on every write and allows key-free dry runs only", async () => {
    const seeded = (await write("make_biochar_product", pureProductBody(a, { placedAt: FIRST_PLACED_AT }))).structuredContent.data;
    const records = (await writeIdempotencyRecords(a)).length;
    for (const [name, args] of [
      ["make_biochar_product", pureProductBody(a)],
      ["update_biochar_product", { biocharProductId: seeded.id, expectedVersion: 1, status: "ready" }],
      ["record_output_stock_movement", movementArgs()],
    ] as const) {
      expect(await call(name, args)).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_required" } });
    }
    expect(await writeIdempotencyRecords(a)).toHaveLength(records);
  });

  it("replays a REST key over MCP for a product and a movement without a second write", async () => {
    const productKey = randomUUID();
    const rest = await postProductRest(a, pureProductBody(a), productKey);
    expect(rest.status).toBe(201);
    const replay = await call("make_biochar_product", { ...pureProductBody(a), requestKey: productKey });
    expect(replay.content[0].text).toMatch(/^Replayed: Made biochar product/);
    expect(replay.structuredContent).toEqual(await rest.json());
    const movementKey = randomUUID();
    const restMovement = await postMovementRest(a, a.source.id, lossBody(), movementKey);
    expect(restMovement.status).toBe(201);
    const movementReplay = await call("record_output_stock_movement", { ...movementArgs(), requestKey: movementKey });
    expect(movementReplay.content[0].text).toMatch(/^Replayed: /);
    expect(movementReplay.structuredContent).toEqual(await restMovement.json());
    const state = await captureProductWriteState(a);
    expect(state.products).toHaveLength(1);
    expect(state.movements).toHaveLength(2);
    expect(await productWriteAudits(a)).toMatchObject([{ source: "rest" }]);
  });

  it("replays an uppercase-UUID REST key over MCP in lowercase for a product and a movement (api/uuid-case)", async () => {
    const productKey = randomUUID();
    const rest = await postProductRest(a, uppercaseUuids(blendedProductBody(a)), productKey);
    expect(rest.status).toBe(201);
    const replay = await call("make_biochar_product", { ...blendedProductBody(a), requestKey: productKey });
    expect(replay.content[0].text).toMatch(/^Replayed: Made biochar product/);
    expect(replay.structuredContent).toEqual(await rest.json());
    const movementKey = randomUUID();
    const restMovement = await postMovementRest(a, a.source.id.toUpperCase(), lossBody(), movementKey);
    expect(restMovement.status).toBe(201);
    const movementReplay = await call("record_output_stock_movement", { ...movementArgs(), requestKey: movementKey });
    expect(movementReplay.content[0].text).toMatch(/^Replayed: /);
    expect(movementReplay.structuredContent).toEqual(await restMovement.json());
    const upperMovement = await call("record_output_stock_movement", { ...movementArgs(lossBody(), a.source.id.toUpperCase()), requestKey: movementKey });
    expect(upperMovement.content[0].text).toMatch(/^Replayed: /);
    const state = await captureProductWriteState(a);
    expect(state.products).toHaveLength(1);
    expect(state.movements).toHaveLength(2);
  });

  it("answers a stale basisFingerprint with a preview, claims no key, and the retry on the preview saves", async () => {
    const stale: string = (await call("make_biochar_product", { ...pureProductBody(a), dryRun: true })).structuredContent.basisFingerprint;
    expect((await postMovementRest(a, a.source.id, lossBody({ occurredAt: FIRST_LOSS_AT }))).status).toBe(201);
    const records = (await writeIdempotencyRecords(a)).length;
    const requestKey = randomUUID();
    const refusal = await call("make_biochar_product", { ...pureProductBody(a), basisFingerprint: stale, requestKey });
    expect(refusal).toMatchObject({ isError: true, structuredContent: { code: "stock_basis_changed", retryable: expect.any(Boolean) } });
    expect(refusal.structuredContent.preview.basisFingerprint).toEqual(expect.any(String));
    expect(refusal.structuredContent.preview.basisFingerprint).not.toBe(stale);
    expect(refusal.structuredContent.preview.stockEffects).toContainEqual(expect.objectContaining({ storageLocationId: a.source.id }));
    expect((await captureProductWriteState(a)).products).toEqual([]);
    expect(await writeIdempotencyRecords(a)).toHaveLength(records);
    const retry = await call("make_biochar_product", { ...pureProductBody(a), basisFingerprint: refusal.structuredContent.preview.basisFingerprint, requestKey });
    expect(retry.isError).toBeUndefined();
    expect((await captureProductWriteState(a)).products).toHaveLength(1);
  });

  it("answers a stale basisFingerprint on a movement with a preview", async () => {
    const stale: string = (await call("record_output_stock_movement", { ...movementArgs(), dryRun: true })).structuredContent.basisFingerprint;
    expect((await postMovementRest(a, a.source.id, lossBody())).status).toBe(201);
    const refusal = await write("record_output_stock_movement", movementArgs(lossBody({ basisFingerprint: stale })));
    expect(refusal).toMatchObject({ isError: true, structuredContent: { code: "stock_basis_changed", preview: { basisFingerprint: expect.any(String) } } });
    expect(refusal.structuredContent.preview.basisFingerprint).not.toBe(stale);
  });

  it("refuses more stock than the bin holds with the typed insufficient_stock issue", async () => {
    const product = await write("make_biochar_product", pureProductBody(a, { biocharWetMassKg: OVERSIZED_WET_KG }));
    expect(product).toMatchObject({ isError: true, structuredContent: { code: "insufficient_stock" } });
    expect(product.structuredContent.issues).toContainEqual(expect.objectContaining({ pointer: "/biocharWetMassKg", code: "insufficient_stock" }));
    const movement = await write("record_output_stock_movement", movementArgs(lossBody({ wetMassKg: OVERSIZED_WET_KG })));
    expect(movement).toMatchObject({ isError: true, structuredContent: { code: "insufficient_stock" } });
    await noChange();
  });

  it("refuses a time in the future", async () => {
    const refusal = await write("make_biochar_product", pureProductBody(a, { placedAt: FUTURE_AT }));
    expect(refusal).toMatchObject({ isError: true, structuredContent: { code: "validation_failed" } });
    await noChange();
  });

  it("answers foreign references as not found without data", async () => {
    const foreign = await seedRestProduct(b);
    for (const [name, args] of [
      ["make_biochar_product", pureProductBody(a, { facilityId: b.facility.id })],
      ["make_biochar_product", pureProductBody(a, { formulationId: b.pure.id })],
      ["make_biochar_product", pureProductBody(a, { sourceBiocharStorageLocationId: b.source.id })],
      ["make_biochar_product", pureProductBody(a, { storageLocationId: b.pureBin.id })],
      ["update_biochar_product", { biocharProductId: foreign.row.id, expectedVersion: 1, status: "ready" }],
      ["record_output_stock_movement", movementArgs(lossBody(), b.source.id)],
    ] as const) {
      const refusal = await write(name, args);
      expect(refusal, name).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
      expect(JSON.stringify(refusal)).not.toContain(foreign.row.code);
    }
    for (const [name, args] of [
      ["get_biochar_product", { idOrCode: foreign.row.id }], ["find_output_stock_movements", { idOrCode: b.source.id }],
      ["find_biochar_products", { facilityId: b.facility.id }],
    ] as const) {
      expect(await call(name, args, a.key), name).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    }
    await noChange();
  });

  it("refuses the write tools without the write scope", async () => {
    const response = await MCP(rpc(a.key, "tools/call", { name: "make_biochar_product", arguments: { ...pureProductBody(a), requestKey: randomUUID() } }));
    const hidden = await rpcBody(response);
    expect(hidden).not.toHaveProperty("result");
    expect(hidden.error).toEqual((await rpcBody(await MCP(rpc(a.key, "tools/call", { name: "unknown_tool", arguments: {} })))).error);
    await noChange();
  });

  it("answers API_WRITES_DISABLED inside MCP and keeps reads working", async () => {
    switches.writesDisabled = true;
    for (const name of WRITE_TOOLS) {
      expect(await call(name, { requestKey: randomUUID() })).toMatchObject({ isError: true, structuredContent: { code: "api_writes_disabled", retryable: true } });
    }
    expect((await call("find_biochar_products", {}, a.key)).isError).toBeUndefined();
    await noChange();
  });

  it("serves reads with the REST list and item envelopes", async () => {
    const made = (await write("make_biochar_product", pureProductBody(a))).structuredContent.data;
    const restList = await GET_PRODUCTS(productApiRequest(`/biochar-products?facilityId=${a.facility.id}`, a.key));
    expect((await call("find_biochar_products", { facilityId: a.facility.id }, a.key)).structuredContent).toEqual(await restList.json());
    for (const idOrCode of [made.id, made.code]) {
      const { GET } = await import("@/app/api/v1/biochar-products/[idOrCode]/route");
      const rest = await GET(productApiRequest(`/biochar-products/${idOrCode}`, a.key), productApiParams(idOrCode));
      expect((await call("get_biochar_product", { idOrCode }, a.key)).structuredContent).toEqual(await rest.json());
    }
    const formulations = await GET_FORMULATIONS(productApiRequest("/formulations", a.key));
    expect((await call("find_formulations", {}, a.key)).structuredContent).toEqual(await formulations.json());
    const movements = await GET_MOVEMENTS(productApiRequest(`/storage-locations/${a.source.id}/stock-movements`, a.key), productApiParams(a.source.id));
    expect((await call("find_output_stock_movements", { idOrCode: a.source.id }, a.key)).structuredContent).toEqual(await movements.json());
    expect(await call("find_output_stock_movements", {}, a.key)).toMatchObject({ isError: true });
  });
});
