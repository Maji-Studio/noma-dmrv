/** Real UI actions, REST and MCP against the worktree test database. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { binMovements, biocharProducts, facilities, orders, storageLocations } from "@/db/schema";
import { POST as MCP } from "@/app/api/mcp/route";
import { createDeliveryFn, updateDeliveryFn } from "@/fn/deliveries";
import { jsonPointer } from "@/lib/api/problem";
import { BILL_OF_LADING_WARNING } from "@/lib/delivery-guidance";
import { representDelivery } from "@/lib/representations/deliveries";
import type { createDeliverySchema, updateDeliverySchema } from "@/schemas/deliveries";
import type { z } from "zod";
import { createApiDeliveryWriteFixture, removeApiDeliveryWriteFixture, deliveryInput, postDelivery, patchDelivery, readDelivery,
  deliveryRows, deliveryRecords, deliveryAudits, DELIVERY_AT, DELIVERY_WET_KG, type ApiDeliveryWriteFixture } from "./helpers/api-delivery-write-fixture";
import { archiveReadOrder } from "./helpers/api-order-read-fixture";
import { rpc, rpcBody } from "./helpers/mcp";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
const TIMEOUT_MS = 90_000;
const LARGE_ORDER_KG = 10_000;
const SHORTAGE_WET_KG = 2000;
const EXCESS_WET_KG = 1001;
const TRANSPORTS = ["action", "rest", "mcp"] as const;
type Transport = typeof TRANSPORTS[number];
const fixtures = new Map<Transport, ApiDeliveryWriteFixture>();
const bases = new Map<Transport, string>();
beforeEach(async () => {
  for (const transport of TRANSPORTS) {
    const f = await createApiDeliveryWriteFixture(); fixtures.set(transport, f);
    await db.update(facilities).set({ timezone: "Europe/Zurich" }).where(and(eq(facilities.organizationId, f.ctx.organizationId), eq(facilities.id, f.facility.id)));
    const preview = await postDelivery(f, deliveryInput(f), randomUUID(), "?dryRun=true");
    expect(preview.status).toBe(200);
    bases.set(transport, (await preview.json()).basisFingerprint);
  }
}, TIMEOUT_MS);
afterEach(async () => {
  for (const f of fixtures.values()) await removeApiDeliveryWriteFixture(f);
  fixtures.clear(); bases.clear(); auth.requireOrgContext.mockReset();
}, TIMEOUT_MS);
async function mcp(f: ApiDeliveryWriteFixture, name: string, args: Record<string, unknown>) {
  const response = await MCP(rpc(f.writeKey, "tools/call", { name, arguments: { ...args, requestKey: randomUUID() } }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}
/** The real form uses its own names, ISO instant, preview basis and movement request key. */
function formInput(f: ApiDeliveryWriteFixture, basisFingerprint: string, changes: Record<string, unknown> = {}) {
  const { deliveredAt, moisturePercent, ...rest } = deliveryInput(f, changes);
  return { ...rest, code: "", status: "delivered", facilityId: f.facility.id, deliveryDate: deliveredAt,
    moistureContentPercent: moisturePercent, basisFingerprint, idempotencyKey: randomUUID() } as unknown as z.infer<typeof createDeliverySchema>;
}
function scrub(value: unknown, f: ApiDeliveryWriteFixture): unknown {
  const dropped = new Set(["id", "code", "createdAt", "updatedAt", "cursorCreatedAt"]);
  return normalizeFixtureIds(JSON.parse(JSON.stringify(value, (key, v) => dropped.has(key) ? undefined : v)), f);
}
/** Refusals retain every field, including issue codes; only fixture-specific ids differ. */
function normalizeFixtureIds<T>(value: T, f: ApiDeliveryWriteFixture): T {
  const labels = [[f.ctx.organizationId, "org"], [f.ctx.userId, "user"], [f.facility.id, "facility"], [f.bin.id, "bin"],
    [f.order.id, "order"], [f.driver.id, "driver"], [f.vehicle.id, "vehicle"], [f.product.id, "product"], [f.recipe.id, "formulation"]];
  let text = JSON.stringify(value);
  for (const [id, label] of labels) text = text.replaceAll(id, `<${label}>`);
  return JSON.parse(text);
}
async function create(transport: Transport, changes: Record<string, unknown> = {}) {
  const f = fixtures.get(transport)!;
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = await createDeliveryFn(formInput(f, bases.get(transport)!, changes));
    if (!result.success) throw new Error(`Create refused: ${result.error}`);
    expect(result).not.toHaveProperty("warning");
    return { data: representDelivery(result.data), warnings: [] };
  }
  if (transport === "rest") {
    const response = await postDelivery(f, deliveryInput(f, changes));
    expect(response.status).toBe(201);
    const output = await response.json();
    return { data: output.data, warnings: output.warnings ?? [] };
  }
  const result = await mcp(f, "record_delivery", deliveryInput(f, changes));
  expect(result.isError).toBeUndefined();
  return { data: result.structuredContent.data, warnings: result.structuredContent.warnings ?? [] };
}
async function update(transport: Transport, id: string, changes: Record<string, unknown>) {
  const f = fixtures.get(transport)!;
  const current = await readDelivery(f, id);
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = await updateDeliveryFn({ deliveryId: id, expectedVersion: current.data.version, ...changes } as z.infer<typeof updateDeliverySchema>);
    if (!result.success) throw new Error(`Update refused: ${result.error}`);
    expect(result).not.toHaveProperty("warning");
    return { data: representDelivery(result.data), warnings: [] };
  }
  if (transport === "rest") {
    const response = await patchDelivery(f, id, changes, current.etag);
    expect(response.status).toBe(200);
    const output = await response.json();
    return { data: output.data, warnings: output.warnings ?? [] };
  }
  const result = await mcp(f, "update_delivery", { deliveryId: id, expectedVersion: current.data.version, ...changes });
  expect(result.isError).toBeUndefined();
  return { data: result.structuredContent.data, warnings: result.structuredContent.warnings ?? [] };
}
async function compare(outputs: Map<Transport, { data: { id: string }; warnings: string[] }>) {
  const results = new Map<Transport, unknown>();
  for (const transport of TRANSPORTS) {
    const f = fixtures.get(transport)!;
    const output = outputs.get(transport)!;
    const representation = (await readDelivery(f, output.data.id)).data;
    expect(representation).toEqual(output.data);
    results.set(transport, scrub({ rows: await deliveryRows(f), representation, output: output.data }, f));
  }
  expect(outputs.get("rest")!.warnings).toEqual(outputs.get("mcp")!.warnings);
  expect(results.get("rest")).toEqual(results.get("action"));
  expect(results.get("mcp")).toEqual(results.get("action"));
}
interface Refusal { code?: string; issues: { pointer: string; code: string; meta?: Record<string, unknown> }[] }
const apiRefusal = (output: { code: string; errors?: Refusal["issues"]; issues?: Refusal["issues"] }): Refusal => ({
  code: output.code, issues: (output.errors ?? output.issues ?? []).map(({ pointer, code, meta }) => ({ pointer, code, ...(meta ? { meta } : {}) })),
});
/** Normalize only the form's documented field aliases; keep every issue code and metadata value. */
const actionPointer = (path: (string | number)[]) => jsonPointer(path.map((part, index) => index === 0 && part === "deliveryDate" ? "deliveredAt" : index === 0 && part === "moistureContentPercent" ? "moisturePercent" : part));
async function refuse(transport: Transport, changes: Record<string, unknown>, id?: string): Promise<Refusal> {
  const f = fixtures.get(transport)!;
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const current = id ? await readDelivery(f, id) : null;
    const result = id ? await updateDeliveryFn({ deliveryId: id, expectedVersion: current!.data.version, ...changes } as z.infer<typeof updateDeliverySchema>)
      : await createDeliveryFn(formInput(f, bases.get(transport)!, changes));
    if (result.success) throw new Error("Expected action refusal.");
    return { code: result.code, issues: (result.issues ?? []).map(({ path, code, meta }) => ({ pointer: actionPointer(path), code, ...(meta ? { meta } : {}) })) };
  }
  if (transport === "rest") {
    const response = id ? await patchDelivery(f, id, changes, (await readDelivery(f, id)).etag) : await postDelivery(f, deliveryInput(f, changes));
    expect(response.status).toBeGreaterThanOrEqual(400);
    return apiRefusal(await response.json());
  }
  const result = await mcp(f, id ? "update_delivery" : "record_delivery", id ? { deliveryId: id, expectedVersion: (await readDelivery(f, id)).data.version, ...changes } : deliveryInput(f, changes));
  expect(result.isError).toBe(true);
  return apiRefusal(result.structuredContent);
}

async function stockState(f: ApiDeliveryWriteFixture) {
  return {
    movements: await db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId)),
    products: await db.select().from(biocharProducts).where(eq(biocharProducts.organizationId, f.ctx.organizationId)),
  };
}

describe("three-way delivery parity", { timeout: TIMEOUT_MS }, () => {
  it("stores the same row and representation with API-only warnings for ISO, offset and facility-local times", async () => {
    const times = { action: DELIVERY_AT, rest: "2026-09-14T14:00:00+02:00", mcp: { date: "2026-09-14", time: "14:00" } };
    const outputs = new Map<Transport, Awaited<ReturnType<typeof create>>>();
    for (const transport of TRANSPORTS) {
      const output = await create(transport, { deliveredAt: times[transport] });
      expect(output.data.deliveredAt).toBe(DELIVERY_AT);
      if (transport !== "action") expect(output.warnings).toEqual([BILL_OF_LADING_WARNING]);
      expect((await deliveryRows(fixtures.get(transport)!))[0].deliveryDate.toISOString()).toBe(DELIVERY_AT);
      outputs.set(transport, output);
    }
    await compare(outputs);
  });
  it("updates the same metadata and warnings, preserving omission and supporting null, positive and source-only distance patches", async () => {
    const outputs = new Map<Transport, Awaited<ReturnType<typeof create>>>();
    for (const transport of TRANSPORTS) outputs.set(transport, await create(transport, { distanceKmOverride: 25, distanceSource: "manual", distanceNote: "Keep note" }));
    const patches = [
      (f: ApiDeliveryWriteFixture) => ({ code: "E2E-PARITY-EDIT", driverId: f.driver.id, vehicleId: f.vehicle.id }),
      () => ({ distanceSource: "document" }), () => ({ distanceKmOverride: 30 }),
      () => ({ distanceKmOverride: null }), () => ({ distanceSource: "document" }),
      () => ({ driverId: null, vehicleId: null, distanceNote: null }),
    ];
    for (const patch of patches) {
      for (const transport of TRANSPORTS) {
        const output = await update(transport, outputs.get(transport)!.data.id, patch(fixtures.get(transport)!));
        expect(output.warnings).toEqual([]);
        expect(output.data.deliveredAt).toBe(DELIVERY_AT);
        expect(output.data.deliveredWetMassKg).toBe(DELIVERY_WET_KG);
        outputs.set(transport, output);
      }
      await compare(outputs);
    }
  });
  const cases = [
    { setup: "foreign", code: "not_found", pointer: "/orderId" },
    { setup: "formulation", code: "validation_failed", pointer: "/storageLocationId" },
    { setup: "mix", code: "validation_failed", pointer: "/sources" },
    { setup: "moisture", code: "validation_failed", pointer: "/moisturePercent" },
    { setup: "balance", code: "conflict", pointer: "/deliveredWetMassKg" },
    { setup: "stock", code: "insufficient_stock", pointer: "/deliveredWetMassKg" },
    { setup: "future", code: "validation_failed", pointer: "/deliveredAt" },
    { setup: "archived", code: "not_found", pointer: "/orderId" },
  ];
  it.each(cases)("returns matching refusal codes, paths and meta for $setup without side effects", async ({ setup, code, pointer }) => {
    const failures = new Map<Transport, Refusal>();
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      let changes: Record<string, unknown> = {};
      if (setup === "foreign") changes = { orderId: fixtures.get(transport === "action" ? "rest" : "action")!.order.id };
      if (setup === "formulation") await db.update(storageLocations).set({ formulationId: f.pure.id }).where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.bin.id)));
      if (setup === "mix") changes = { sources: [{ layerId: f.product.id, moisturePercent: 20 }] };
      if (setup === "moisture") changes = { moisturePercent: undefined };
      if (setup === "balance") changes = { deliveredWetMassKg: EXCESS_WET_KG };
      if (setup === "stock") {
        await db.update(orders).set({ quantityKg: LARGE_ORDER_KG }).where(and(eq(orders.organizationId, f.ctx.organizationId), eq(orders.id, f.order.id)));
        changes = { deliveredWetMassKg: SHORTAGE_WET_KG };
      }
      if (setup === "future") changes = { deliveredAt: "2099-09-14T12:00:00Z" };
      if (setup === "archived") await archiveReadOrder(f, f.order.id);
      const beforeStock = await stockState(f);
      const failure = await refuse(transport, changes);
      expect(failure).toMatchObject({ code, issues: expect.arrayContaining([expect.objectContaining({ pointer })]) });
      if (setup === "balance") expect(failure.issues[0].meta).toEqual({ measure: "order_remaining_wet", availableWetKg: f.order.quantityKg, requestedWetKg: EXCESS_WET_KG, unit: "kg" });
      failures.set(transport, normalizeFixtureIds(failure, f));
      expect(await stockState(f)).toEqual(beforeStock);
      expect(await deliveryRows(f)).toEqual([]);
      expect(await deliveryRecords(f)).toEqual([]);
      expect(await deliveryAudits(f)).toEqual([]);
    }
    expect(failures.get("rest")).toEqual(failures.get("action"));
    expect(failures.get("mcp")).toEqual(failures.get("action"));
  });
  it("refuses foreign driver and vehicle metadata with matching codes and pointers", async () => {
    const failures = new Map<Transport, Refusal[]>();
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      const foreign = fixtures.get(transport === "action" ? "rest" : "action")!;
      const made = await create(transport);
      const before = await deliveryRows(f);
      const results: Refusal[] = [];
      for (const [field, id] of [["driverId", foreign.driver.id], ["vehicleId", foreign.vehicle.id]]) {
        const failure = await refuse(transport, { [field]: id }, made.data.id);
        expect(failure).toMatchObject({ code: "not_found", issues: [{ code: "not_found", pointer: `/${field}` }] });
        results.push(failure);
      }
      expect(await deliveryRows(f)).toEqual(before);
      failures.set(transport, results);
    }
    expect(failures.get("rest")).toEqual(failures.get("action"));
    expect(failures.get("mcp")).toEqual(failures.get("action"));
  });
});
