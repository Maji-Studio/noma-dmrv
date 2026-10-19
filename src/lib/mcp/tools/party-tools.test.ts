import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { toolFailure } from "../results";
import type { ApiRouteContext } from "@/lib/api/route";
import { supplierWriteTools } from "./supplier-tools";
import { customerWriteTools } from "./customer-tools";

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/read-models/api-suppliers", () => ({ readApiSupplier: mocks.read }));
vi.mock("@/lib/read-models/api-customers", () => ({ readApiCustomer: mocks.read }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
const TOO_MANY_LOCATIONS = 51;
const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const cascade = { orders: [], cascadeFingerprint: "cascade" };
const CLOCK = "2026-10-06T10:00:00.000Z";
const DEADLINE_MS = 10_000;
describe.each(["supplier", "customer"] as const)("%s write tools", kind => {
  const tools = (kind === "supplier" ? supplierWriteTools : customerWriteTools).filter(tool => !tool.name.endsWith("_location"));
  const idKey = `${kind}Id`;
  const row = { id: ID, code: kind === "supplier" ? "SUP-0001" : "CUS-0001", name: "Party", version: 1, ...(kind === "supplier" ? { sourceRegion: null } : { cropType: null }), archivedAt: null, createdAt: CLOCK, updatedAt: CLOCK };
  const context = { ctx: { credentialId: "credential", organizationId: "org", userId: "user" }, deadlineAt: 0,
    requestId: "request", instance: "/api/mcp", headers: new Headers() } as unknown as ApiRouteContext;
  const args = (name: string) => name === `create_${kind}` ? { name: "Party", locations: [{ name: "Site", country: "Tanzania", gpsLatitude: -8, gpsLongitude: 34 }] } : { [idKey]: ID, expectedVersion: 1 };
  beforeEach(() => {
    vi.resetAllMocks();
    context.deadlineAt = Date.now() + DEADLINE_MS;
    mocks.read.mockResolvedValue(row);
    mocks.run.mockImplementation(async (operation, _ctx, input, options) => {
      const parsed = operation.input.safeParse(input);
      if (!parsed.success) throw validationFailed(parsed.error);
      return { data: operation.id === `delete_${kind}` ? kind === "customer" ? { customer: row, cascade, warnings: [] } : row : { [kind]: row, locations: [] }, dryRun: options.dryRun, replayed: false };
    });
  });
  it.each(tools.map(tool => tool.name))("requires a key and supports keyless previews for %s", async name => {
    const tool = tools.find(candidate => candidate.name === name)!;
    await expect(tool.execute(context, args(name))).rejects.toMatchObject({ code: "idempotency_key_required" });
    expect(mocks.run).not.toHaveBeenCalled();
    const preview = await tool.execute(context, { ...args(name), dryRun: true });
    expect(preview.body).toEqual({ data: row, ...(name === "delete_customer" ? { cascade } : {}), ...(name === `create_${kind}` ? { locations: [] } : {}) });
    expect(tool.output.safeParse(preview.body).success).toBe(true);
    expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
  });

  it.each(tools)("shares REST replay identity and audit on $name", async tool => {
    const result = await tool.execute(context, { ...args(tool.name), requestKey: "write" });
    const [operation, ctx, input, options] = mocks.run.mock.calls[0];
    expect(operation.id).toBe(tool.name);
    expect(ctx).toBe(context.ctx);
    expect(input).toEqual(args(tool.name));
    expect(options.audit).toEqual({ transport: "mcp", credentialId: "credential", requestId: "request" });
    expect(options.idempotency).toEqual({ credentialId: "credential", key: "write",
      ...(tool.name === `create_${kind}` ? {} : { target: ID, precondition: '"1.2"' }) });
    expect(result.body).toEqual(tool.name === "delete_customer" ? { data: row, cascade } : tool.name === `delete_${kind}` ? { deleted: { id: ID, code: row.code } } : { data: row, ...(tool.name === `create_${kind}` ? { locations: [] } : {}) });
    expect(tool.output.safeParse(result.body).success).toBe(true);
    expect(tool.summarize(result.body, false)).toContain(row.code);
  });
  it.each(tools.filter(tool => tool.name !== `create_${kind}`))("requires a version and canonicalizes the UUID on $name", async tool => {
    await expect(tool.execute(context, { [idKey]: ID, requestKey: "write" }))
      .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["expectedVersion"] }] });
    expect(mocks.run).not.toHaveBeenCalled();
    await tool.execute(context, { [idKey]: ID.toUpperCase(), expectedVersion: 1, requestKey: "write" });
    expect(mocks.run.mock.calls[0][3].idempotency.target).toBe(ID);
  });
  it.each(tools)("rejects extra fields on $name", async tool => {
    await expect(tool.execute(context, { ...args(tool.name), requestKey: "write", extra: true }))
      .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["extra"], code: "unknown_field" }] });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(tools.filter(tool => tool.name !== `create_${kind}`))("returns the current representation on stale $name", async tool => {
    mocks.run.mockRejectedValueOnce(new DomainError("stale_version", "Changed."));
    const failure = await tool.execute(context, { ...args(tool.name), requestKey: "write" })
      .catch(error => toolFailure(error, context, tool.name));
    expect(failure).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current: row } });
  });

  if (kind === "customer") it("returns a fresh cascade preview on cascade_changed", async () => {
    const tool = tools.find(tool => tool.name === "delete_customer")!;
    mocks.run.mockRejectedValueOnce(new DomainError("cascade_changed", "Cascade changed."));
    const result = await tool.execute(context, { ...args(tool.name), cascadeFingerprint: "old", requestKey: "write" })
      .catch(error => toolFailure(error, context, tool.name));
    expect(result).toMatchObject({ isError: true, structuredContent: { code: "cascade_changed", preview: cascade } });
    expect(mocks.run.mock.calls[1][2]).not.toHaveProperty("cascadeFingerprint");
    expect(mocks.run.mock.calls[1][3]).toMatchObject({ dryRun: true });
    expect(mocks.run.mock.calls[1][3]).not.toHaveProperty("idempotency");
  });

  it("publishes required locations and Q81 fields while refusing private app fields", async () => {
    const tool = tools.find(tool => tool.name === `create_${kind}`)!;
    const valid = args(tool.name);
    const location = { name: "Source", country: "Tanzania", stateRegion: "Mbeya", city: "Mbeya", gpsLatitude: -8, gpsLongitude: 34,
      facilityDistances: [{ facilityId: ID, distanceKm: 12, distanceSource: "manual" }], isDefault: true, ...(kind === "customer" ? { siteDescription: "North field", defaultSoilTemperatureC: 0 } : {}) };
    expect(tool.input.safeParse({ ...valid, locations: [location] }).success).toBe(true);
    for (const locations of [[], Array.from({ length: TOO_MANY_LOCATIONS }, () => location), [{ ...location, gpsLatitude: undefined }], [{ ...location, address: "Private" }]]) {
      await expect(tool.execute(context, { ...valid, locations, dryRun: true })).rejects.toMatchObject({ code: "validation_failed" });
    }
    for (const field of (kind === "supplier" ? ["contactName", "contactEmail", "contactPhone", "address", "location"] : ["contactEmail", "contactPhone", "address"])) {
      await expect(tool.execute(context, { ...valid, [field]: "Private", dryRun: true })).rejects.toMatchObject({ code: "validation_failed" });
    }
    for (const candidate of tools) {
      expect(candidate.description).toContain(`find_${kind}s (${kind}s:read)`);
      expect(candidate.description).toContain("do not create a duplicate");
      expect(candidate.description).toContain("case and whitespace insensitive");
      expect(candidate.description).toContain("archived: true");
      expect(candidate.description).toContain("Restore before editing or reusing");
      expect(candidate.description).not.toMatch(/[–—]/);
    }
    expect(tool.description).toContain("Coordinates are required for each location");
    const remove = tools.find((candidate) => candidate.name === `delete_${kind}`)!;
    if (kind === "customer") {
      // Decision 121: orders without deliveries go with the customer, so agents must list them first.
      expect(remove.description).toContain("Orders without deliveries, archived orders included, are deleted with it");
      expect(remove.description).toContain("cascadeFingerprint");
      expect(remove.description).not.toContain("Orders or registered storage sites prevent deletion");
    } else {
      expect(remove.description).toContain("Feedstock intakes prevent deletion");
    }
  });

});
