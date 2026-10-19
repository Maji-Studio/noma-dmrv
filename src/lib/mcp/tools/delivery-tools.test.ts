import { apiKeyContext } from "../../../../tests/helpers/api-context";
import { beforeEach, expect, it, vi } from "vitest";
import { DELIVERY_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "@/lib/api/etag";
import type { ApiRouteContext } from "@/lib/api/route";
import { BILL_OF_LADING_WARNING } from "@/lib/delivery-guidance";
import { deliveryBalanceExceeded } from "@/lib/delivery-domain-errors";
import { DomainError } from "@/lib/domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { toToolSchema } from "@/lib/operations/mcp-schema";
import { toolFailure, toolOutputSchema } from "../results";
import { deliveryWriteTools } from "./delivery-tools";

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/data-access/delivery-output-writes", () => ({}));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/lib/read-models/api-deliveries", () => ({ readApiDelivery: mocks.read }));
const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const CLOCK = "2026-09-14T12:00:00.000Z";
const DEADLINE_MS = 10_000;
const MASS_KG = 100;
const row = { id: ID, code: "DL-1", version: 2, facilityId: ID, orderId: ID, storageLocationId: ID, deliveredAt: CLOCK,
  deliveredWetMassKg: MASS_KG, moisturePercent: 20, dryBiocharKg: 80, driverId: null, vehicleId: null,
  distanceKmOverride: null, distanceSource: null, distanceNote: null, destinationCustomerLocationId: ID,
  archivedAt: null, createdAt: CLOCK, updatedAt: CLOCK };
const allocations = [{ layerId: ID, code: "BP-1", dryBiocharKg: 80, solidsKg: 80, wetKg: MASS_KG, moisturePercent: 20, policy: "fifo" }];
const create = { orderId: ID, storageLocationId: ID, deliveredAt: CLOCK, deliveredWetMassKg: MASS_KG, moisturePercent: 20 };
const target = { deliveryId: ID, expectedVersion: row.version };
const context = { ctx: apiKeyContext({ credentialId: "credential", organizationId: "org", userId: "user" }), deadlineAt: 0,
  requestId: "request", instance: "/api/mcp", headers: new Headers() } as unknown as ApiRouteContext;
const tool = (name: string) => deliveryWriteTools.find(candidate => candidate.name === name)!;
const args = (name: string) => name === "record_delivery" ? create : target;
beforeEach(() => {
  vi.resetAllMocks();
  context.deadlineAt = Date.now() + DEADLINE_MS;
  mocks.read.mockResolvedValue(row);
  mocks.run.mockImplementation(async (operation, _ctx, input, options) => {
    const parsed = operation.input.safeParse(input);
    if (!parsed.success) throw validationFailed(parsed.error);
    return { data: { delivery: row, warnings: operation.id === "record_delivery" ? [BILL_OF_LADING_WARNING] : [], basisFingerprint: "basis", allocations },
      dryRun: options.dryRun, replayed: false, stockEffects: [] };
  });
});
it.each(deliveryWriteTools)("shares REST output and replay options for $name", async candidate => {
  const result = await candidate.execute(context, { ...args(candidate.name), requestKey: "write" });
  const [, ctx, input, options] = mocks.run.mock.calls[0];
  expect(ctx).toBe(context.ctx);
  expect(input).toEqual(args(candidate.name));
  expect(options.audit).toEqual({ transport: "mcp", credentialId: "credential", requestId: "request" });
  expect(options.idempotency).toEqual({ credentialId: "credential", key: "write", ...(candidate.name === "record_delivery" ? {} : { target: ID, precondition: representationEtag(row.version, DELIVERY_REPRESENTATION_REVISION) }) });
  expect(candidate.output.safeParse(result.body).success).toBe(true);
  expect(candidate.annotations).toEqual({ readOnlyHint: false, openWorldHint: false, idempotentHint: true, destructiveHint: candidate.name === "update_delivery" });
  expect(candidate.scope).toBe("deliveries:write");
  expect(candidate.summarize(result.body, false)).toContain(row.code);
  expect(candidate.summarize(result.body, true)).toMatch(/^Dry run: would/);
});
it.each(deliveryWriteTools)("requires requestKey except on dry runs for $name", async candidate => {
  await expect(candidate.execute(context, args(candidate.name))).rejects.toMatchObject({ code: "idempotency_key_required", issues: [{ path: ["requestKey"] }] });
  expect(mocks.run).not.toHaveBeenCalled();
  const result = await candidate.execute(context, { ...args(candidate.name), dryRun: true });
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
  expect(candidate.output.safeParse(result.body).success).toBe(true);
  if (candidate.name === "record_delivery") {
    expect(result.body).toEqual({ data: row, allocations, stockEffects: [], basisFingerprint: "basis", warnings: [BILL_OF_LADING_WARNING] });
    expect(candidate.summarize(result.body, false)).toContain(BILL_OF_LADING_WARNING);
  } else expect(result.body).toEqual({ data: row });
});
it("requires expectedVersion, rejects corrections, and canonicalizes update targets", async () => {
  await expect(tool("update_delivery").execute(context, { deliveryId: ID, requestKey: "write" })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["expectedVersion"] }] });
  for (const field of ["deliveredAt", "deliveredWetMassKg", "moisturePercent", "sources", "orderId", "storageLocationId"]) {
    await expect(tool("update_delivery").execute(context, { ...target, requestKey: "write", [field]: 1 })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: [field], code: "unknown_field" }] });
  }
  await tool("update_delivery").execute(context, { ...target, deliveryId: ID.toUpperCase(), requestKey: "write" });
  expect(mocks.run.mock.calls[0][3].idempotency.target).toBe(ID);
});
it("retains the stale representation and order balance metadata in MCP errors", async () => {
  mocks.run.mockRejectedValueOnce(new DomainError("stale_version", "Changed."));
  let caught: unknown;
  try { await tool("update_delivery").execute(context, { ...target, requestKey: "write" }); } catch (error) { caught = error; }
  expect(await toolFailure(caught, context, "update_delivery")).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current: row } });
  expect(await toolFailure(deliveryBalanceExceeded(0, MASS_KG), context, "record_delivery")).toMatchObject({ isError: true, structuredContent: { code: "conflict", issues: [{ pointer: "/deliveredWetMassKg", code: "conflict", meta: { measure: "order_remaining_wet", availableWetKg: 0, requestedWetKg: MASS_KG, unit: "kg" } }] } });
});
it("returns the same stale-basis preview including allocations without claiming a fallback key", async () => {
  mocks.run.mockRejectedValueOnce(new DomainError("stock_basis_changed", "Stock changed."));
  let caught: unknown;
  try { await tool("record_delivery").execute(context, { ...create, requestKey: "write", basisFingerprint: "stale" }); } catch (error) { caught = error; }
  expect(mocks.run.mock.calls[1][2]).toEqual(create);
  expect(mocks.run.mock.calls[1][3]).toMatchObject({ dryRun: true });
  expect(mocks.run.mock.calls[1][3].idempotency).toBeUndefined();
  expect(await toolFailure(caught, context, "record_delivery")).toMatchObject({ isError: true, structuredContent: { code: "stock_basis_changed", preview: { basisFingerprint: "basis", stockEffects: [], allocations } } });
});
it("publishes time shapes, source grounding and the conditional key rule", () => {
  for (const candidate of deliveryWriteTools) {
    const published = toToolSchema(candidate.input)["~standard"].jsonSchema.input({ target: "draft-2020-12" });
    expect(published.required).not.toContain("requestKey");
    expect(JSON.stringify(published)).toContain("Required unless dryRun is true");
    expect(toolOutputSchema(candidate.output)["~standard"].jsonSchema.output({ target: "draft-2020-12" }).type).toBe("object");
    expect(candidate.description).not.toMatch(/[–—]/);
  }
  const record = tool("record_delivery");
  expect(record.input.safeParse({ ...create, deliveredAt: { date: "2026-09-14", time: "14:00" } }).success).toBe(true);
  expect(record.input.safeParse({ ...create, deliveredAt: "2026-09-14T14:00:00" }).success).toBe(false);
  expect(JSON.stringify(toToolSchema(record.input)["~standard"].jsonSchema.input({ target: "draft-2020-12" }))).toContain("Product layerId from get_bin_stock");
  for (const text of ["log_feedstock_delivery", "find_orders", "get_order_balance", "remaining wet kg", "find_storage_locations", "type=product_bin", "formulationId", "get_bin_stock", "sub-bins", "wet kg", "percent of wet mass", "one-way km", "round trip", "above 0", "Omit distanceKmOverride", "deducts from the product bin", "Without sources", "drawOrder", "stockEffects", "allocations", "basisFingerprint", "order facility's zone", "{ date, time }", "cannot be in the future", "Never invent moisture readings", "ask the operator", "ignored when sources", "including ingredient solids", "recorded reading"]) expect(record.description).toContain(text);
  for (const text of ["metadata only", "code, driver, vehicle and distance", "Mass, moisture and time", "corrections made in the app", "expectedVersion"]) expect(tool("update_delivery").description).toContain(text);
});

it("keeps historical bill of lading warnings on replay", async () => {
  const originalWarning = "No bill of lading is uploaded. Upload the bill of lading in the app.";
  mocks.run.mockResolvedValueOnce({ data: { delivery: row, allocations, warnings: [originalWarning] }, replayed: true, dryRun: false });
  const result = await tool("record_delivery").execute(context, { ...create, requestKey: "historical-delivery" });
  expect(result.body.warnings).toEqual([originalWarning]);
  expect(result.replayed).toBe(true);
  expect(tool("record_delivery").description).toContain("request_document_upload (ownerType delivery, documentType bill_of_lading)");
});
