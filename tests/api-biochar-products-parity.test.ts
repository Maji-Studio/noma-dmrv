/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProductSourceAllocations, outputStockAllocations, storageLocations } from "@/db/schema";
import { POST as MCP } from "@/app/api/mcp/route";
import { createBiocharProductFn } from "@/fn/biochar-products";
import { postOutputStockFn, previewOutputStockFn } from "@/fn/output-stock";
import { previewProductStockFn } from "@/fn/product-stock-preview";
import {
  BIOCHAR_MOISTURE_PERCENT, BIOCHAR_WET_KG, createApiProductFixture, INGREDIENT_MOISTURE_PERCENT, INGREDIENT_WET_KG, removeApiProductFixture,
  WATER_KG, type ApiProductFixture,
} from "./helpers/api-biochar-product-fixture";
import {
  blendedProductBody, captureProductWriteState, lossBody, postMovementRest, postProductRest, productWriteAudits, readRestProduct,
} from "./helpers/api-biochar-write-fixture";
import { rpc, rpcBody } from "./helpers/mcp";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
const TIMEOUT_MS = 90_000;
const TRANSPORTS = ["action", "rest", "mcp"] as const;
type Transport = typeof TRANSPORTS[number];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const fixtures = new Map<Transport, ApiProductFixture>();
beforeEach(async () => {
  for (const transport of TRANSPORTS) fixtures.set(transport, await createApiProductFixture());
}, TIMEOUT_MS);
afterEach(async () => {
  for (const f of fixtures.values()) await removeApiProductFixture(f);
  fixtures.clear();
  auth.requireOrgContext.mockReset();
}, TIMEOUT_MS);

function sourceReceiptMarker(f: ApiProductFixture) {
  return { count: f.runs.length, identityHash: createHash("sha256").update(JSON.stringify(f.runs.map(run => run.id).sort())).digest("hex") };
}

/**
 * Each transport runs in its own organization. Fixture ids become labels, the ids
 * the writes generated become the labels the caller names, any other id stays visible
 * as a distinct <unexpected-N>, and generated codes, timestamps, sequences, request
 * keys and fingerprints are dropped. What remains is what the write stored, how its
 * rows refer to each other, and how stock moved.
 */
function scrub(value: unknown, f: ApiProductFixture, generated: Record<string, string> = {}): unknown {
  const labels: [string, string][] = [
    [f.ctx.organizationId, "org"], [f.ctx.userId, "user"], [f.facility.id, "facility"], [f.source.id, "source"], [f.bin.id, "bin"],
    [f.pureBin.id, "pureBin"], [f.ingredientBin.id, "ingredientBin"], [f.pure.id, "pure"], [f.recipe.id, "recipe"],
    [f.ingredient.id, "ingredient"], [f.ingredientType.id, "ingredientType"], [f.r1, "r1"], [f.r2, "r2"],
    ...Object.entries(generated),
  ];
  // The form also sends a request key and product versions (UI only, decision 53); the API sends neither.
  const dropped = new Set(["createdAt", "updatedAt", "code", "storageLocationCode", "basisFingerprint", "payloadHash", "idempotencyKey", "expectedProductVersions"]);
  let text = JSON.stringify(value, (key, v) => dropped.has(key) || /Sequence$/.test(key) ? undefined : typeof v === "bigint" ? v.toString() : v);
  text = text.replaceAll(f.tag, "<tag>");
  // Separate organizations have different receipt ids. Only normalize the exact expected hash.
  text = text.replaceAll(sourceReceiptMarker(f).identityHash, "<source-receipts>");
  for (const [id, label] of labels) text = text.replaceAll(id, `<${label}>`);
  const unexpected = new Map<string, string>();
  return JSON.parse(text.replace(UUID_PATTERN, (id) => {
    if (!unexpected.has(id)) unexpected.set(id, `<unexpected-${unexpected.size + 1}>`);
    return unexpected.get(id)!;
  }));
}
/** Stock effects come back in bin-id order, which differs by organization; order them by stable label. */
function sortEffects(scrubbed: unknown): unknown {
  const sort = (effects: unknown) => Array.isArray(effects)
    ? [...effects].sort((x, y) => String(x.storageLocationId).localeCompare(String(y.storageLocationId))) : effects;
  const { product, movement } = scrubbed as { product: { stockEffects?: unknown }; movement: { stockEffects?: unknown } };
  return { product: { ...product, stockEffects: sort(product.stockEffects) }, movement: { ...movement, stockEffects: sort(movement.stockEffects) } };
}

async function mcp(f: ApiProductFixture, name: string, args: object) {
  const { result } = await rpcBody(await MCP(rpc(f.writeKey, "tools/call", { name, arguments: args })));
  expect(result.isError).not.toBe(true);
  return result.structuredContent;
}
/** The blend as the create form submits it: biochar plus ingredients before water, one ingredient bin line. */
async function formProduct(f: ApiProductFixture) {
  const body = blendedProductBody(f);
  const ingredientBins = [{
    formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, feedstockTypeName: f.ingredientType.name,
    feedstockTypeCategory: f.ingredientType.category, storageLocationId: f.ingredientBin.id,
    massKg: INGREDIENT_WET_KG, moistureContentPercent: INGREDIENT_MOISTURE_PERCENT,
  }];
  // The form previews the biochar as weighed and submits the blend (biochar plus ingredients).
  const preview = {
    facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: body.placedAt, sourceBiocharStorageLocationId: f.source.id,
    storageLocationId: f.bin.id, massKg: BIOCHAR_WET_KG, moistureContentPercent: BIOCHAR_MOISTURE_PERCENT,
    waterAddedKg: WATER_KG, ingredientBins,
  };
  const previewed = await previewProductStockFn(preview);
  if (!previewed.success) throw new Error(`Preview refused: ${previewed.error}`);
  return { ...preview, massKg: BIOCHAR_WET_KG + INGREDIENT_WET_KG, status: "testing" as const, idempotencyKey: randomUUID(), basisFingerprint: previewed.data[0].basisFingerprint };
}
async function makeProduct(transport: Transport, f: ApiProductFixture) {
  if (transport === "action") {
    const result = await createBiocharProductFn(await formProduct(f));
    if (!result.success) throw new Error(`Create refused: ${result.error}`);
    return result.data.id;
  }
  const input = blendedProductBody(f);
  if (transport === "mcp") return (await mcp(f, "make_biochar_product", { ...input, requestKey: randomUUID() })).data.id as string;
  const response = await postProductRest(f, input);
  expect(response.status).toBe(201);
  return (await response.json()).data.id as string;
}
async function recordLoss(transport: Transport, f: ApiProductFixture) {
  const body = lossBody();
  if (transport === "action") {
    const entry = { storageLocationId: f.source.id, facilityId: f.facility.id, occurredAt: body.occurredAt, kind: "loss" as const,
      wetMassKg: body.wetMassKg, moisturePercent: body.moisturePercent };
    const previewed = await previewOutputStockFn(entry);
    if (!previewed.success) throw new Error(`Preview refused: ${previewed.error}`);
    const result = await postOutputStockFn({ ...entry, reason: body.reason, idempotencyKey: randomUUID(),
      expectedProductVersions: previewed.data.expectedProductVersions, basisFingerprint: previewed.data.basisFingerprint });
    if (!result.success) throw new Error(`Loss refused: ${result.error}`);
  } else if (transport === "mcp") await mcp(f, "record_output_stock_movement", { storageLocationId: f.source.id, ...body, requestKey: randomUUID() });
  else expect((await postMovementRest(f, f.source.id, body)).status).toBe(201);
}
async function previews(transport: Transport, f: ApiProductFixture) {
  if (transport === "action") return null;
  const product = transport === "mcp" ? await mcp(f, "make_biochar_product", { ...blendedProductBody(f), dryRun: true })
    : await (await postProductRest(f, blendedProductBody(f), randomUUID(), "?dryRun=true")).json();
  const movement = transport === "mcp" ? await mcp(f, "record_output_stock_movement", { storageLocationId: f.source.id, ...lossBody(), dryRun: true })
    : await (await postMovementRest(f, f.source.id, lossBody(), randomUUID(), "?dryRun=true")).json();
  expect(product.basisFingerprint).toEqual(expect.any(String));
  expect(movement.basisFingerprint).toEqual(expect.any(String));
  return sortEffects(scrub({ product, movement }, f));
}

/** Rows with their references checked, then normalized with the generated ids named by role. */
async function captureNormalized(f: ApiProductFixture, productId: string) {
  const state = await captureProductWriteState(f);
  const org = f.ctx.organizationId;
  const sourceAllocations = await db.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.organizationId, org));
  const stockAllocations = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.organizationId, org));
  expect(state.products).toHaveLength(1);
  expect(state.movements).toHaveLength(2);
  for (const movement of state.movements) expect(movement.inputSnapshot?.receiptMarker).toEqual(sourceReceiptMarker(f));
  const [drawMovement, lossMovement] = state.movements;
  expect(state.products[0].id).toBe(productId);
  expect(drawMovement.outputKind).toBe("production_draw");
  expect(lossMovement.outputKind).toBe("loss");
  expect(sourceAllocations.length).toBeGreaterThan(0);
  for (const allocation of sourceAllocations) expect(allocation.biocharProductId).toBe(productId);
  const draws = stockAllocations.filter((allocation) => allocation.movementId === drawMovement.id);
  expect(draws.length).toBeGreaterThan(0);
  for (const allocation of draws) expect(allocation.targetBiocharProductId).toBe(productId);
  const losses = stockAllocations.filter((allocation) => allocation.movementId === lossMovement.id);
  expect(losses.length).toBeGreaterThan(0);
  expect(draws.length + losses.length).toBe(stockAllocations.length);
  const generated = { [productId]: "product", [drawMovement.id]: "movement-1", [lossMovement.id]: "movement-2" };
  // Allocation rows are join rows; their own ids carry no meaning, and the query order is unspecified.
  const joinRows = (rows: object[]) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id")))
    .map((row) => JSON.stringify(scrub(row, f, generated))).sort();
  return {
    state: scrub({ ...state, representation: (await readRestProduct(f, productId)).row }, f, generated),
    sourceAllocations: joinRows(sourceAllocations),
    stockAllocations: joinRows(stockAllocations),
  };
}

describe("biochar product three-way parity", { timeout: TIMEOUT_MS }, () => {
  it.each(["oldest_first", "newest_first"] as const)("previews and saves products and losses with equal provenance and stock effects across transports (%s)", async (drawOrder) => {
    const previewed: unknown[] = [];
    const captured: unknown[] = [];
    const audits: unknown[] = [];
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      await db.update(storageLocations).set({ drawOrder }).where(and(eq(storageLocations.id, f.source.id), eq(storageLocations.organizationId, f.ctx.organizationId)));
      auth.requireOrgContext.mockResolvedValue(f.ctx);
      previewed.push(await previews(transport, f));
      expect((await captureProductWriteState(f)).products).toEqual([]);
      const id = await makeProduct(transport, f);
      await recordLoss(transport, f);
      captured.push(await captureNormalized(f, id));
      const allocations = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.organizationId, f.ctx.organizationId));
      expect(allocations).toHaveLength(2);
      for (const allocation of allocations) expect(allocation).toMatchObject({
        productionRunId: drawOrder === "newest_first" ? f.r2 : f.r1,
        basisSnapshot: { policy: drawOrder === "newest_first" ? "lifo" : "fifo", defaultDrawOrder: drawOrder },
      });
      const events = await productWriteAudits(f);
      const movementEvents = await productWriteAudits(f, "movement");
      if (transport === "action") expect([...events, ...movementEvents]).toEqual([]); // API audit only.
      else {
        for (const event of [...events, ...movementEvents]) {
          expect(event.transport).toBe(transport);
          expect(event.credentialId).toBe(f.writeCredentialId);
        }
      }
      audits.push([...events, ...movementEvents].map(({ operationId, outcomeCode, versionBefore, versionAfter, changedFields }) =>
        ({ operationId, outcomeCode, versionBefore, versionAfter, changedFields })).sort((x, y) => x.operationId.localeCompare(y.operationId)));
    }
    expect(captured[1]).toEqual(captured[0]);
    expect(captured[2]).toEqual(captured[0]);
    expect(previewed[2]).toEqual(previewed[1]);
    expect(audits[2]).toEqual(audits[1]);
    expect(audits[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: "make_biochar_product", outcomeCode: "created", versionBefore: null, versionAfter: 1 }),
    ]));
  });
});
