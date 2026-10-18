import { beforeEach, describe, expect, it, vi } from "vitest";
import { supplierWriteTools } from "./supplier-tools";
import { customerWriteTools } from "./customer-tools";
import type { ApiRouteContext } from "@/lib/api/route";
import { validationFailed } from "@/lib/operations/errors";
import { DomainError } from "@/lib/domain-errors";
import { toolFailure } from "../results";
import { toToolSchema } from "@/lib/operations/mcp-schema";

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/lib/read-models/api-supplier-locations", () => ({ readApiSupplierLocation: mocks.read }));
vi.mock("@/lib/read-models/api-customer-locations", () => ({ readApiCustomerLocation: mocks.read }));
const PARENT_ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const LOCATION_ID = "cff780ab-50a1-4024-955e-e099456acdf8";
const CLOCK = "2026-10-06T10:00:00.000Z";
const DEADLINE_MS = 10_000;
const tools = [...supplierWriteTools, ...customerWriteTools].filter(tool => tool.name.endsWith("_location"));
const site = { name: "Site", country: "Tanzania", gpsLatitude: -8, gpsLongitude: 34 };
const context = { ctx: { credentialId: "credential", organizationId: "org", userId: "user" }, deadlineAt: 0,
  requestId: "request", instance: "/api/mcp", headers: new Headers() } as unknown as ApiRouteContext;
const kind = (name: string) => name.includes("supplier") ? "supplier" : "customer";
const args = (name: string): Record<string, unknown> => ({ [`${kind(name)}Id`]: PARENT_ID,
  ...(name.startsWith("add_") ? site : { locationId: LOCATION_ID, expectedVersion: 1, ...(name.startsWith("update_") ? { city: "Mbeya" } : {}) }),
});
const row = (name: string) => ({ ...site, id: LOCATION_ID, [`${kind(name)}Id`]: PARENT_ID, version: 1,
  isDefault: false, archivedAt: null, stateRegion: null, city: null, facilityDistances: [], createdAt: CLOCK, updatedAt: CLOCK,
  ...(kind(name) === "customer" ? { siteDescription: null, defaultSoilTemperatureC: null } : {}),
});
beforeEach(() => {
  vi.resetAllMocks();
  context.deadlineAt = Date.now() + DEADLINE_MS;
  mocks.run.mockImplementation(async (operation, _ctx, input, options) => {
    const parsed = operation.input.safeParse(input);
    if (!parsed.success) throw validationFailed(parsed.error);
    return { data: { data: row(operation.id), warnings: [] }, dryRun: options.dryRun, replayed: false };
  });
});

describe("party location tools", () => {
  it("composes the eight location commands into the party write tools", () => {
    expect(tools.map(tool => tool.name)).toEqual([
      "add_supplier_location", "update_supplier_location", "delete_supplier_location",
      "add_customer_location", "update_customer_location", "delete_customer_location", "archive_customer_location", "restore_customer_location",
    ]);
  });
  it.each(tools)("requires a key, but allows a keyless preview on $name", async tool => {
    await expect(tool.execute(context, args(tool.name))).rejects.toMatchObject({ code: "idempotency_key_required" });
    expect(mocks.run).not.toHaveBeenCalled();
    const result = await tool.execute(context, { ...args(tool.name), dryRun: true });
    expect(result.body).toEqual({ data: row(tool.name) });
    expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
    expect(tool.output.safeParse(result.body).success).toBe(true);
  });
  it.each(tools)("uses REST's operation, replay identity, audit and envelope on $name", async tool => {
    const result = await tool.execute(context, { ...args(tool.name), requestKey: "write" });
    const [operation, ctx, input, options] = mocks.run.mock.calls[0];
    expect(operation.id).toBe(tool.name);
    expect(ctx).toBe(context.ctx);
    expect(input).toEqual(args(tool.name));
    expect(options.audit).toEqual({ transport: "mcp", credentialId: "credential", requestId: "request" });
    expect(options.idempotency).toEqual({ credentialId: "credential", key: "write",
      ...(tool.name.startsWith("add_") ? {} : { target: LOCATION_ID, precondition: '"1.1"' }) });
    expect(result.body).toEqual({ data: row(tool.name) });
    expect(tool.output.safeParse(result.body).success).toBe(true);
    expect(tool.summarize(result.body, false)).toContain(LOCATION_ID);
    expect(tool.scope).toBe(`${kind(tool.name)}s:${tool.name.startsWith("delete_") ? "delete" : "write"}`);
  });
  it.each(tools)("requires a parent and canonicalizes all UUIDs on $name", async tool => {
    const withoutParent = args(tool.name);
    delete withoutParent[`${kind(tool.name)}Id`];
    await expect(tool.execute(context, { ...withoutParent, requestKey: "write" })).rejects.toMatchObject({
      code: "validation_failed", issues: [{ path: [`${kind(tool.name)}Id`] }],
    });
    expect(mocks.run).not.toHaveBeenCalled();
    await tool.execute(context, { ...args(tool.name), [`${kind(tool.name)}Id`]: PARENT_ID.toUpperCase(),
      ...(tool.name.startsWith("add_") ? {} : { locationId: LOCATION_ID.toUpperCase() }), requestKey: "write" });
    const [operation, , input, options] = mocks.run.mock.calls[0];
    expect(operation.input.parse(input)[`${kind(tool.name)}Id`]).toBe(PARENT_ID);
    if (!tool.name.startsWith("add_")) expect(options.idempotency.target).toBe(LOCATION_ID);
  });
  it.each(tools)("rejects extra and private fields on $name", async tool => {
    for (const field of ["extra", "address"]) {
      await expect(tool.execute(context, { ...args(tool.name), [field]: "Private", dryRun: true })).rejects.toMatchObject({
        code: "validation_failed", issues: [{ path: [field], code: "unknown_field" }],
      });
    }
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(tools.filter(tool => !tool.name.startsWith("add_")))("requires expectedVersion on $name", async tool => {
    await expect(tool.execute(context, { ...args(tool.name), expectedVersion: undefined, dryRun: true })).rejects.toMatchObject({
      code: "validation_failed", issues: [{ path: ["expectedVersion"] }],
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(tools)("preserves warnings and replayed outcomes on $name", async tool => {
    mocks.run.mockResolvedValueOnce({ data: { data: row(tool.name), warnings: ["Default location changed."] }, dryRun: false, replayed: true });
    const result = await tool.execute(context, { ...args(tool.name), requestKey: "write" });
    expect(result).toMatchObject({ replayed: true, body: { data: row(tool.name), warnings: ["Default location changed."] } });
  });
  it.each(tools.filter(tool => !tool.name.startsWith("add_")))("returns the parent-scoped current representation on stale $name", async tool => {
    mocks.run.mockRejectedValueOnce(new DomainError("stale_version", "Changed."));
    mocks.read.mockResolvedValueOnce(row(tool.name));
    const result = await tool.execute(context, { ...args(tool.name), requestKey: "write" }).catch(error => toolFailure(error, context, tool.name));
    expect(result).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current: row(tool.name) } });
    expect(mocks.read).toHaveBeenCalledWith(context.ctx, PARENT_ID, LOCATION_ID);
  });
  it.each(tools)("returns a retryable deadline error before running $name", async tool => {
    context.deadlineAt = Date.now();
    const result = await tool.execute(context, { ...args(tool.name), requestKey: "write" }).catch(error => toolFailure(error, context, tool.name));
    expect(result).toMatchObject({ isError: true, structuredContent: { code: "deadline_exceeded", retryable: true } });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("publishes add inputs without child preconditions and keeps guidance in descriptions", () => {
    for (const tool of tools) {
      expect(() => toToolSchema(tool.input)).not.toThrow();
      expect(tool.description).not.toMatch(/[–—]/);
      expect(tool.description).toContain("requestKey");
      if (tool.name.startsWith("add_")) {
        expect(tool.input.safeParse(args(tool.name)).success).toBe(true);
        expect(tool.input.safeParse({ ...args(tool.name), expectedVersion: 1 }).success).toBe(false);
      }
    }
    expect(tools.find(tool => tool.name === "archive_customer_location")!.description).toContain("existing orders, deliveries and storage-site registration");
    expect(tools.find(tool => tool.name === "delete_customer_location")!.description).toContain("archive it instead");
    expect(tools.find(tool => tool.name === "restore_customer_location")!.description).toContain("archived: true");
  });
});
