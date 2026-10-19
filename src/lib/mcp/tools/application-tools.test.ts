import { apiKeyContext } from "../../../../tests/helpers/api-context";
import { beforeEach, expect, it, vi } from "vitest";
import type { ApiContext } from "@/lib/auth/api-context";
import { principalAllows, type ApiScope } from "@/lib/auth/api-scopes";
import type { ApiRouteContext } from "@/lib/api/route";
import { resourceQueries } from "@/lib/api/query-schemas";
import { APPLICATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "@/lib/api/etag";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { validationFailed } from "@/lib/operations/errors";
import { UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";
import { mcpInstructions } from "../instructions";
import { applicationReadTools, applicationWriteTools } from "./application-tools";

const mocks = vi.hoisted(() => ({ run: vi.fn(), list: vi.fn(), read: vi.fn(), balance: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/lib/api/applications-queries", () => ({ readApplicationListFromInput: mocks.list }));
vi.mock("@/lib/read-models/api-applications", () => ({ readApiApplication: mocks.read }));
vi.mock("@/lib/read-models/api-delivery-application-balance", () => ({ readApiDeliveryApplicationBalance: mocks.balance }));
const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const DEADLINE_MS = 10_000;
const MCP_INSTRUCTIONS_MAX_CHARS = 2000;
const create = { deliveryId: ID, applicationDate: "2025-07-08", appliedWetMassKg: 100, fieldSizeHa: 3 };
const target = { applicationId: ID, expectedVersion: 1 };
const row = { id: ID, code: "AP-1", version: 1, deliveryId: ID, applicationDate: create.applicationDate, appliedWetMassKg: 100,
  dryBiocharKg: 80, fieldSizeHa: 3, fieldIdentifier: null, cropType: null, applicationMethod: null, evidenceMethod: "location",
  gpsLatitude: 1, gpsLongitude: 2, gisBoundary: null, soilTemperatureSource: null, soilTemperatureC: null, allocations: [],
  createdAt: "2025-07-08T00:00:00Z", updatedAt: "2025-07-08T00:00:00Z" };
const output = { application: row, allocations: [], deliveryBalance: { remainingWetMassKgBefore: 500, remainingWetMassKgAfter: 400 }, warnings: ["GPS copied from customer location North."] };
const context = { ctx: apiKeyContext({ credentialId: "credential", organizationId: "org", orgRole: "admin", scopes: [] }),
  requestId: "request", deadlineAt: 0 } as unknown as ApiRouteContext;
const args = (name: string) => name === "record_application" ? create : target;
const write = (name: string) => applicationWriteTools.find(tool => tool.name === name)!;
beforeEach(() => {
  vi.clearAllMocks(); context.deadlineAt = Date.now() + DEADLINE_MS;
  mocks.run.mockImplementation(async (operation, _ctx, input, options) => {
    const parsed = operation.input.safeParse(input);
    if (!parsed.success) throw validationFailed(parsed.error);
    return { data: operation.id === "delete_application" ? row : output, dryRun: options.dryRun, replayed: false };
  });
});
it.each([
  { scopes: ["applications:read"], role: "admin", names: ["find_applications", "get_application"] },
  { scopes: ["applications:read", "deliveries:read"], role: "admin", names: ["find_applications", "get_application", "get_delivery_application_balance"] },
  { scopes: ["applications:write"], role: "owner", names: ["record_application", "update_application"] },
  { scopes: ["applications:read", "applications:write", "applications:delete", "deliveries:read"], role: "member", names: [] },
])("admits $role with $scopes", ({ scopes, role, names }) => {
  const ctx = { principal: { kind: "api-key" }, scopes: scopes as ApiScope[], orgRole: role } as ApiContext;
  expect([...applicationReadTools, ...applicationWriteTools].filter(tool => principalAllows(ctx, tool.scope!)).map(tool => tool.name)).toEqual(names);
});
it("shares every application list filter and reader with REST", async () => {
  const tool = applicationReadTools[0]; expect(tool.input).toBe(resourceQueries.applications.list);
  const filters = { facilityId: ID, deliveryId: ID, orderId: ID, creditBatchId: ID, evidenceMethod: "boundary", q: "AP", code: "AP-1", appliedFrom: "2025-07-01", appliedBefore: "2025-08-01", cursor: "cursor", limit: 1 };
  const page = { data: [], nextCursor: null }; mocks.list.mockResolvedValue(page);
  expect(await tool.execute(context.ctx, filters)).toBe(page); expect(mocks.list).toHaveBeenCalledWith(context.ctx, filters);
  expect(toOperationJsonSchema(tool.input)).toMatchObject({ properties: { creditBatchId: { description: resourceQueries.applications.list.shape.creditBatchId.description } } });
});
it("returns GET's representation and balance body with canonical ids", async () => {
  mocks.read.mockResolvedValue(row); const balance = { data: { remainingWetMassKg: 400 } }; mocks.balance.mockResolvedValue(balance);
  expect(await applicationReadTools[1].execute(context.ctx, { idOrCode: ID.toUpperCase() })).toEqual({ data: row });
  expect(mocks.read).toHaveBeenCalledWith(context.ctx, { id: ID });
  expect(await applicationReadTools[2].execute(context.ctx, { idOrCode: "DL-1" })).toBe(balance);
  expect(mocks.balance).toHaveBeenCalledWith(context.ctx, { code: "DL-1" });
});
it.each(applicationWriteTools)("requires a key except for dry runs on $name", async tool => {
  await expect(tool.execute(context, args(tool.name))).rejects.toMatchObject({ code: "idempotency_key_required" });
  expect(mocks.run).not.toHaveBeenCalled();
  const result = await tool.execute(context, { ...args(tool.name), dryRun: true });
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
  expect(tool.output.safeParse(result.body).success).toBe(true);
});
it.each(["update_application", "delete_application"])("requires expectedVersion for %s", async name => {
  await expect(write(name).execute(context, { applicationId: ID, requestKey: "write" })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["expectedVersion"] }] });
});
it.each(applicationWriteTools)("uses MCP audit and REST replay preconditions on $name", async tool => {
  const result = await tool.execute(context, { ...args(tool.name), requestKey: "write" });
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ audit: { transport: "mcp", credentialId: "credential", requestId: "request" },
    idempotency: { credentialId: "credential", key: "write", ...(tool.name === "record_application" ? {} : { target: ID, precondition: representationEtag(1, APPLICATION_REPRESENTATION_REVISION) }) } });
  if (tool.name !== "delete_application") {
    expect(result.body).toMatchObject({ data: row, allocations: [], deliveryBalance: output.deliveryBalance, warnings: output.warnings });
    expect(tool.summarize(result.body, false)).toContain(output.warnings[0]);
  } else expect(result.body).toEqual({ deleted: { id: ID, code: row.code } });
});
it.each(["biocharAppliedTons", "source", "capturedAt", "collection", "stats"])("refuses unpublished top-level %s", async field => {
  await expect(write("record_application").execute(context, { ...create, [field]: 1, requestKey: "write" })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: [field], code: "unknown_field" }] });
  expect(mocks.run).not.toHaveBeenCalled();
});
it("publishes raw geometry without the app envelope schema", () => {
  const schema = toOperationJsonSchema(write("record_application").input);
  expect(schema).toMatchObject({ additionalProperties: false, properties: { gisBoundary: { description: expect.stringContaining("Raw GeoJSON") } } });
});
it("grounds applications and keeps instructions within their existing cap", () => {
  for (const tool of [...applicationReadTools, ...applicationWriteTools]) {
    expect(tool.description).not.toMatch(/[–—]/); expect(tool.description).toContain(UNTRUSTED_TEXT);
  }
  for (const phrase of ["not a delivery", "find_deliveries", "hasRemainingMass=true", "get_delivery_application_balance", "wet kg", "hectares", "local calendar day", "not before", "not in the future", "derived", "Never invent field size or GPS", "soil temperature", "warnings", "raw GeoJSON", "WGS 84", "larger", "request_document_upload", "ownerType: application", "committed allocations are authoritative"]) expect(write("record_application").description).toContain(phrase);
  expect(applicationReadTools[1].description).toContain("/applications/{idOrCode}/boundary");
  expect(mcpInstructions.length).toBeLessThanOrEqual(MCP_INSTRUCTIONS_MAX_CHARS);
});

it("uses singular and plural application summaries", () => {
  const tool = applicationReadTools[0];
  expect(tool.summarize({ data: [], nextCursor: null })).toBe("0 applications.");
  expect(tool.summarize({ data: [{}], nextCursor: "cursor" })).toBe("1 application. More results: pass nextCursor.");
});
