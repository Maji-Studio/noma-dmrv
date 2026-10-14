import { beforeEach, expect, it, vi } from "vitest";
import { BIOCHAR_PRODUCT_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "@/lib/api/etag";
import type { ApiRouteContext } from "@/lib/api/route";
import { DomainError } from "@/lib/domain-errors";
import { BIOCHAR_PRODUCT_MASS, OUTPUT_STOCK_COUNT, OUTPUT_STOCK_NO_CORRECTIONS } from "@/lib/operations/agent-guidance";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { mcpRequestAccess } from "../server";
import { biocharProductWriteTools } from "./biochar-product-tools";
import { outputStockWriteTools } from "./output-stock-tools";
import { readTools } from "./read-tools";
import { rational } from "@/lib/output-stock/exact";
import { UNRESOLVED_STOCK_SENTENCES } from "@/lib/output-stock/layer-projection";

const mocks = vi.hoisted(() => ({ run: vi.fn(), readProduct: vi.fn(), readStock: vi.fn() }));
vi.mock("@/data-access/api-output-bin-stock", () => ({ readApiOutputBinStock: mocks.readStock }));
vi.mock("@/data-access/samples", () => ({}));
vi.mock("@/lib/read-models/api-lab-samples", () => ({ readApiLabSample: vi.fn(), readApiLabSampleList: vi.fn() }));
vi.mock("@/lib/read-models/api-credit-batches", () => ({ readApiCreditBatch: vi.fn(), readApiCreditBatchList: vi.fn() }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/data-access/biochar-product-references", () => ({}));
vi.mock("@/data-access/biochar-product-create", () => ({}));
vi.mock("@/data-access/biochar-product-input", () => ({}));
vi.mock("@/data-access/biochar-product-update", () => ({}));
vi.mock("@/data-access/biochar-product-record", () => ({}));
vi.mock("@/data-access/output-stock-post", () => ({}));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/data-access/api-output-stock-movements", () => ({ requireApiOutputBin: vi.fn() }));
vi.mock("@/lib/read-models/api-biochar-products", () => ({ readApiBiocharProduct: mocks.readProduct, readApiBiocharProductList: vi.fn() }));
vi.mock("@/lib/read-models/api-formulations", () => ({ readApiFormulation: vi.fn(), readApiFormulationList: vi.fn() }));
vi.mock("@/lib/read-models/api-output-stock-movements", () => ({ readApiOutputStockMovement: vi.fn(), readApiOutputStockMovementList: vi.fn() }));
vi.mock("@/data-access/feedstocks", () => ({}));
vi.mock("@/data-access/production-runs", () => ({}));
vi.mock("@/data-access/production-run-input", () => ({}));
vi.mock("@/data-access/storage-object-deletions", () => ({}));
vi.mock("@/lib/read-models/api-production-runs", () => ({ readApiProductionRun: vi.fn(), readApiProductionRunList: vi.fn() }));
vi.mock("@/lib/read-models/api-reactors", () => ({ readApiReactorList: vi.fn(), readApiReactor: vi.fn() }));

const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const BIN = "ea31ace1-5b30-4443-adb4-26b43bfa5599";
const CLOCK = "2026-10-06T10:00:00.000Z";
const DEADLINE_MS = 10_000;
const product = {
  id: ID, code: "BP-26-0001", version: 2, facilityId: ID, formulationId: ID, status: "testing", placedAt: CLOCK, productionDate: CLOCK,
  expiresAt: null, sourceBiocharStorageLocationId: BIN, storageLocationId: ID, biocharWetMassKg: 500, biocharMoisturePercent: 10,
  waterAddedKg: 0, densityKgM3: null, ingredients: [], sourceAllocations: [], archivedAt: null, createdAt: CLOCK, updatedAt: CLOCK,
};
const movement = {
  id: ID, storageLocationId: BIN, kind: "loss", occurredAt: CLOCK, wetMassKg: 25, moisturePercent: 10, dryDeltaKg: -22.5,
  balanceBeforeDryKg: 100, balanceAfterDryKg: 77.5, reason: "Spilled.", correctsMovementId: null, correctedByMovementId: null,
  productionRunIds: [], biocharProductIds: [], targetBiocharProductId: null, deliveryId: null, createdAt: CLOCK,
};
const context = {
  ctx: { userId: "user", credentialId: "credential", organizationId: "org", orgRole: "admin", scopes: ["biochar-products:write", "biochar-products:read", "formulations:read"] },
  deadlineAt: 0, requestId: "request", instance: "/api/mcp", headers: new Headers(),
} as unknown as ApiRouteContext;
const make = { facilityId: ID, formulationId: ID, placedAt: CLOCK, sourceBiocharStorageLocationId: BIN, storageLocationId: ID, biocharWetMassKg: 500, biocharMoisturePercent: 10, waterAddedKg: 0, ingredients: [] };
const update = { biocharProductId: ID, expectedVersion: 2, status: "ready" };
const record = { storageLocationId: BIN, kind: "loss", occurredAt: CLOCK, wetMassKg: 25, moisturePercent: 10, reason: "Spilled." };
const tools = [...biocharProductWriteTools, ...outputStockWriteTools];
const args: Record<string, Record<string, unknown>> = { make_biochar_product: make, update_biochar_product: update, record_output_stock_movement: record };
const outputs: Record<string, unknown> = { make_biochar_product: product, update_biochar_product: product, record_output_stock_movement: { movement, basisFingerprint: "basis" } };
const stale = () => new DomainError("stock_basis_changed", "Stock changed.");

beforeEach(() => {
  vi.resetAllMocks();
  context.deadlineAt = Date.now() + DEADLINE_MS;
  mocks.readProduct.mockResolvedValue(product);
});
function succeed(name: string) {
  const output = name === "make_biochar_product" ? { product, basisFingerprint: "basis" } : outputs[name];
  mocks.run.mockResolvedValue({ data: output, dryRun: false, replayed: false, stockEffects: [] });
}

it("registers the three write tools under the shared scope with no correction field", () => {
  expect(tools.map((tool) => tool.name)).toEqual(["make_biochar_product", "update_biochar_product", "record_output_stock_movement"]);
  for (const tool of tools) {
    expect(tool.scope).toBe("biochar-products:write");
    expect(mcpRequestAccess(context.ctx, { method: "tools/call", params: { name: tool.name } })).toBe("write");
  }
  const contract = JSON.stringify(toOperationJsonSchema(outputStockWriteTools[0].input));
  expect(contract).not.toContain("correctsMovementId");
  expect(contract).not.toContain("delivery");
  expect(tools[1].annotations.destructiveHint).toBe(true);
  expect(tools[0].annotations.destructiveHint).toBe(false);
});
it("tells agents about the weighed mass, the basis fingerprint, counts and corrections", () => {
  expect(tools[0].description).toContain(BIOCHAR_PRODUCT_MASS);
  expect(tools[0].description).toContain("basisFingerprint");
  expect(tools[2].description).toContain(OUTPUT_STOCK_COUNT);
  expect(tools[2].description).toContain(OUTPUT_STOCK_NO_CORRECTIONS);
  for (const tool of tools) expect(tool.description).not.toMatch(/[–—]/);
});
it.each(tools)("runs $name with MCP audit, the shared key options and a valid output", async (tool) => {
  succeed(tool.name);
  const result = await tool.execute(context, { ...args[tool.name], requestKey: "one-write" });
  const [, ctx, , options] = mocks.run.mock.calls[0];
  expect(ctx).toBe(context.ctx);
  expect(options.audit).toEqual({ transport: "mcp", credentialId: "credential", requestId: "request" });
  const target = tool.name === "update_biochar_product" ? { target: ID, precondition: representationEtag(2, BIOCHAR_PRODUCT_REPRESENTATION_REVISION) }
    : tool.name === "record_output_stock_movement" ? { target: BIN } : {};
  expect(options.idempotency).toEqual({ credentialId: "credential", key: "one-write", ...target });
  expect(options.deadlineMs).toBeLessThanOrEqual(DEADLINE_MS);
  expect(tool.output.safeParse(result.body).success).toBe(true);
  expect(tool.summarize(result.body, false)).not.toMatch(/^Dry run/);
});
it.each(tools)("requires a requestKey for $name and lets a dry run omit it", async (tool) => {
  succeed(tool.name);
  await expect(tool.execute(context, args[tool.name])).rejects.toMatchObject({ code: "idempotency_key_required" });
  expect(mocks.run).not.toHaveBeenCalled();
  mocks.run.mockResolvedValue({ data: outputs[tool.name] === movement ? outputs[tool.name] : tool.name === "make_biochar_product" ? { product, basisFingerprint: "basis" } : outputs[tool.name], dryRun: true, replayed: false, stockEffects: [] });
  const result = await tool.execute(context, { ...args[tool.name], dryRun: true });
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
  expect(tool.summarize(result.body, true)).toMatch(/^Dry run: would/);
  if (tool.name !== "update_biochar_product") expect(result.body.basisFingerprint).toBe("basis");
});
it("rejects fields outside the published contract, including corrections and UI fields", async () => {
  await expect(tools[2].execute(context, { ...record, correctsMovementId: ID, requestKey: "k" })).rejects.toMatchObject({ code: "validation_failed" });
  await expect(tools[0].execute(context, { ...make, idempotencyKey: "form", requestKey: "k" })).rejects.toMatchObject({ code: "validation_failed" });
  await expect(tools[1].execute(context, { ...update, massKg: 5, requestKey: "k" })).rejects.toMatchObject({ code: "validation_failed" });
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each([0, 2])("answers stock_basis_changed with a preview for write tool %i", async (index) => {
  const tool = tools[index === 0 ? 0 : 2];
  const fresh = tool.name === "make_biochar_product" ? { product, basisFingerprint: "fresh" } : { movement, basisFingerprint: "fresh" };
  mocks.run.mockRejectedValueOnce(stale());
  mocks.run.mockResolvedValueOnce({ data: fresh, dryRun: true, replayed: false, stockEffects: [] });
  await expect(tool.execute(context, { ...args[tool.name], basisFingerprint: "old", requestKey: "k" }))
    .rejects.toMatchObject({ code: "stock_basis_changed", preview: { basisFingerprint: "fresh", stockEffects: [] } });
  expect(mocks.run.mock.calls[1][2]).not.toHaveProperty("basisFingerprint");
  expect(mocks.run.mock.calls[1][3]).toEqual({ dryRun: true, deadlineMs: expect.any(Number), pool: undefined });
});
it("returns the current product when an update is stale", async () => {
  mocks.run.mockRejectedValueOnce(new DomainError("stale_version", "Changed."));
  await expect(tools[1].execute(context, { ...update, requestKey: "k" })).rejects.toMatchObject({ status: 412, current: product });
});
it("re-renders JSONB key order for a replayed product", async () => {
  succeed("make_biochar_product");
  const original = await tools[0].execute(context, { ...make, requestKey: "k" });
  const reordered = Object.fromEntries(Object.entries(product).reverse());
  mocks.run.mockResolvedValueOnce({ data: { basisFingerprint: "basis", product: reordered }, dryRun: false, replayed: true });
  const replay = await tools[0].execute(context, { ...make, requestKey: "k" });
  expect(replay.replayed).toBe(true);
  expect(JSON.stringify(replay.body)).toBe(JSON.stringify(original.body));
});
it("registers the biochar and formulation read tools under their own scopes", () => {
  const expected = [["find_biochar_products", "biochar-products:read"], ["get_biochar_product", "biochar-products:read"],
    ["find_formulations", "formulations:read"], ["find_output_stock_movements", "biochar-products:read"], ["get_bin_stock", "biochar-products:read"]];
  for (const [name, scope] of expected) expect(readTools.find((tool) => tool.name === name)).toMatchObject({ kind: "read", scope });
});
it("requires a bin id or code for find_output_stock_movements and rejects control characters", async () => {
  const tool = readTools.find((candidate) => candidate.name === "find_output_stock_movements")!;
  await expect(async () => tool.execute(context.ctx, {})).rejects.toMatchObject({ status: 400, code: "invalid_query" });
  await expect(async () => tool.execute(context.ctx, { idOrCode: "BIN-\u0000" })).rejects.toMatchObject({ code: "not_found" });
});

it("reads bin stock through the shared representation with strict input and one sentence", async () => {
  const tool = readTools.find((candidate) => candidate.name === "get_bin_stock")!;
  const zero = rational(BigInt(0));
  mocks.readStock.mockResolvedValueOnce({ bin: { storageLocationId: BIN, code: "OB-2", type: "biochar_bin", facilityId: ID, archivedAt: null, formulationId: null },
    stockMode: "split", status: "resolved", unresolvedReason: null, subBins: [],
    totals: { dryBiocharKg: zero, solidsKg: zero, estimatedWetKg: zero, estimatedMoisturePercent: null, moistureBasis: null } });
  const body = await tool.execute(context.ctx, { storageLocation: BIN.toUpperCase(), facilityId: ID.toUpperCase() });
  expect(mocks.readStock).toHaveBeenCalledWith(context.ctx, { identifier: { id: BIN }, facilityId: ID });
  expect(body).toMatchObject({ data: { storageLocationId: BIN, totals: { dryBiocharKg: 0, solidsKg: 0, estimatedWetKg: 0 } } });
  expect(tool.output.parse(body)).toEqual(body);
  expect(tool.summarize(body)).toBe("Bin OB-2 stock read.");
  const unresolved = { data: { ...(body.data as object), status: "unresolved", unresolvedReason: UNRESOLVED_STOCK_SENTENCES.run_incomplete, totals: null } };
  expect(tool.summarize(unresolved)).toBe(`Bin OB-2 stock is unknown. ${UNRESOLVED_STOCK_SENTENCES.run_incomplete}`);
  for (const input of [{}, { storageLocation: BIN, at: CLOCK }, { storageLocation: BIN, facilityId: "bad" }]) {
    await expect(async () => tool.execute(context.ctx, input)).rejects.toMatchObject({ code: "invalid_query" });
  }
  await expect(tool.execute(context.ctx, { storageLocation: "OB-\u0000" })).rejects.toMatchObject({ code: "not_found" });
  expect(tool.description).toContain("mix-bin loss takes no sources");
  expect(tool.description).toContain("basisFingerprint");
});
