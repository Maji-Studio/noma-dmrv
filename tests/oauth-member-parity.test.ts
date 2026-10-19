import * as revisions from "@/config/api-rest";
import { z } from "zod";
import openapi from "../openapi/v1.json";
import { guardApiMethod } from "@/lib/api/method-not-allowed";
import { POST as MCP } from "@/app/api/mcp/route";
import { rpcBody } from "./helpers/mcp";
import { DOCUMENT_SHA256, DOCUMENT_BYTES } from "./helpers/api-document-write-fixture";
import { confirmDocumentUpload } from "@/lib/documents/confirm-upload";
import { mapConfirmOutcome } from "@/lib/documents/confirm-outcome";
import type { Operation } from "@/lib/operations/runner";
import { getOAuthConfig } from "@/lib/auth/oauth-config";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { db } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { applicationOutputAllocations, customerLocations, customers, formulations, members, supplierLocations, suppliers } from "@/db/schema";
import { createBiocharProduct } from "@/data-access/biochar-products";
import { createApiDocumentWriteFixture, removeApiDocumentWriteFixture } from "./helpers/api-document-write-fixture";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { resolveApiContext, type ApiContext } from "@/lib/auth/api-context";
import { API_SCOPES, principalAllows } from "@/lib/auth/api-scopes";
import { API_DOCUMENT_OWNERS, API_DOCUMENT_OWNER_TYPES, canAccessOwnerDocuments } from "@/lib/documents/api-owners";
import { assertCanManageDocumentEntity } from "@/data-access/documents";
import { operationRegistry } from "@/lib/operations/registry";
import { runOperationInProcess } from "@/lib/operations/runner";
import { readApiFeedstock } from "@/lib/read-models/api-feedstocks";
import { readApiProductionRun } from "@/lib/read-models/api-production-runs";
import { readApiBiocharProduct } from "@/lib/read-models/api-biochar-products";
import { readApiFormulation } from "@/lib/read-models/api-formulations";
import { readApiSupplier } from "@/lib/read-models/api-suppliers";
import { readApiCustomer } from "@/lib/read-models/api-customers";
import { readApiOrder } from "@/lib/read-models/api-orders";
import { readApiDelivery } from "@/lib/read-models/api-deliveries";
import { readApiLabSample } from "@/lib/read-models/api-lab-samples";
import { readApiApplication } from "@/lib/read-models/api-applications";
import { readApiFacility } from "@/lib/read-models/api-facilities";
import { readApiReactor } from "@/lib/read-models/api-reactors";
import { readApiFeedstockType } from "@/lib/read-models/api-feedstock-types";
import { readApiStorageLocation } from "@/lib/read-models/api-storage-locations";
import { readApiVehicle } from "@/lib/read-models/api-vehicles";
import { readApiDriver } from "@/lib/read-models/api-drivers";
import { readApiCreditBatch } from "@/lib/read-models/api-credit-batches";
import { createOAuthFixture, type OAuthFixture } from "./helpers/oauth";

vi.mock("@/config/env", async importOriginal => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, OAUTH_PROVIDER_ENABLED: true } };
});
let f: OAuthFixture;
let oauth: ApiContext;
beforeEach(async () => {
  f = await createOAuthFixture();
  const token = await f.accessToken({ scopes: API_SCOPES.filter(scope => !scope.endsWith(":delete")) });
  const result = await resolveApiContext(token.request(), getOAuthConfig().rest);
  if (!result.ok) throw new Error(result.denial);
  oauth = result.ctx;
});
afterEach(async () => {
  // Parties and formulations created through the API do not cascade from organizations.
  await db.delete(customerLocations).where(inArray(customerLocations.organizationId, f.orgIds));
  await db.delete(customers).where(inArray(customers.organizationId, f.orgIds));
  await db.delete(supplierLocations).where(inArray(supplierLocations.organizationId, f.orgIds));
  await db.delete(suppliers).where(inArray(suppliers.organizationId, f.orgIds));
  await db.delete(formulations).where(inArray(formulations.organizationId, f.orgIds));
  await f.cleanup();
});

const updates = {
  update_feedstock: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_feedstock, ctx, input),
  update_production_run: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_production_run, ctx, input),
  update_biochar_product: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_biochar_product, ctx, input),
  update_formulation: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_formulation, ctx, input),
  update_supplier: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_supplier, ctx, input),
  update_customer: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_customer, ctx, input),
  update_order: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_order, ctx, input),
  update_delivery: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_delivery, ctx, input),
  update_lab_sample: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_lab_sample, ctx, input),
  update_application: (ctx: OrgContext, input: unknown) => runOperationInProcess(operationRegistry.update_application, ctx, input),
};

const families = [
  ["feedstocks", readApiFeedstock, "update_feedstock", "feedstockId"],
  ["production-runs", readApiProductionRun, "update_production_run", "productionRunId"],
  ["biochar-products", readApiBiocharProduct, "update_biochar_product", "biocharProductId"],
  ["formulations", readApiFormulation, "update_formulation", "formulationId"],
  ["suppliers", readApiSupplier, "update_supplier", "supplierId"],
  ["customers", readApiCustomer, "update_customer", "customerId"],
  ["orders", readApiOrder, "update_order", "orderId"],
  ["deliveries", readApiDelivery, "update_delivery", "deliveryId"],
  ["lab-samples", readApiLabSample, "update_lab_sample", "labSampleId"],
  ["applications", readApiApplication, "update_application", "applicationId"],
] as const;

async function outcome(run: () => Promise<unknown>) {
  try { return { ok: true, value: await run() }; }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    return { ok: false, code: "code" in error ? error.code : null, message: error.message };
  }
}


it.each([
  ["facilities", readApiFacility], ["reactors", readApiReactor], ["feedstock-types", readApiFeedstockType],
  ["storage-locations", readApiStorageLocation], ["vehicles", readApiVehicle], ["drivers", readApiDriver], ["credit-batches", readApiCreditBatch],
] as const)("%s retains the app Member read boundary and exposes no write permission", async (family, read) => {
  const id = randomUUID();
  expect(principalAllows(oauth, `${family}:read`)).toBe(true);
  expect(API_SCOPES).not.toContain(`${family}:write`);
  const app = await outcome(() => read(f.ctx, { id }));
  expect(app).toMatchObject({ ok: false, code: "not_found" });
  expect(await outcome(() => read(oauth, { id }))).toEqual(app);
});

it.each(API_DOCUMENT_OWNER_TYPES)("%s document authorization matches the app Member", async ownerType => {
  const id = randomUUID();
  expect(canAccessOwnerDocuments(oauth, ownerType, "read")).toBe(true);
  expect(canAccessOwnerDocuments(oauth, ownerType, "write")).toBe(true);
  const entityType = API_DOCUMENT_OWNERS[ownerType].entityType;
  const app = await outcome(() => assertCanManageDocumentEntity(f.ctx, entityType, id));
  expect(app.ok).toBe(false);
  expect(await outcome(() => assertCanManageDocumentEntity(oauth, entityType, id))).toEqual(app);
  expect(canAccessOwnerDocuments({ ...oauth, scopes: [] }, ownerType, "write")).toBe(false);
});

const PARITY_TIMEOUT_MS = 120_000;
it("Members can read and save every exposed entity family and authorize each document owner", async () => {
  const chain = await createApiDocumentWriteFixture();
  let supplierId: string | undefined;
  try {
    const memberId = randomUUID();
    await db.insert(members).values({ id: memberId, organizationId: chain.ctx.organizationId, userId: f.userId, role: "member" });
    const token = await f.accessToken({ organizationId: chain.ctx.organizationId, memberId,
      scopes: API_SCOPES.filter(scope => !scope.endsWith(":delete")) });
    const resolved = await resolveApiContext(token.request(), getOAuthConfig().rest);
    if (!resolved.ok) throw new Error(resolved.denial);
    const api = resolved.ctx;
    const app: OrgContext = { userId: f.userId, organizationId: chain.ctx.organizationId, orgRole: "member", isPlatformAdmin: false };
    const product = await createBiocharProduct(app, {
      code: `E2E-PARITY-${chain.tag}`, facilityId: chain.facility.id, formulationId: chain.recipe.id,
      placedAt: "2026-09-12T12:00:00.000Z", sourceBiocharStorageLocationId: chain.source.id, storageLocationId: chain.bin.id,
      massKg: 1000, moistureContentPercent: 10, waterAddedKg: 0, idempotencyKey: randomUUID(),
      composition: { ingredients: [{ formulationIngredientId: chain.ingredient.id, feedstockTypeId: chain.ingredientType.id, massKg: 200, moistureContentPercent: 60 }] },
    });
    // The document fixture has only an application header; saves require frozen source shares.
    await db.insert(applicationOutputAllocations).values({
      organizationId: app.organizationId, applicationId: chain.owners.application.id,
      deliveryId: chain.owners.delivery.id, biocharProductId: product.id, productionRunId: chain.runs[0].id,
      wetMassKg: String(tonnesToKg(chain.owners.application.biocharAppliedTons)),
      dryMassKg: String(tonnesToKg(chain.owners.application.biocharAppliedDryTons!)),
    });
    const [supplier] = await db.insert(suppliers).values({ organizationId: app.organizationId, code: `E2E-SUP-${chain.tag}`, name: "E2E OAuth parity supplier" }).returning();
    supplierId = supplier.id;
    const ids: Record<typeof families[number][0], string> = {
      feedstocks: chain.owners.feedstock.id, "production-runs": chain.runs[0].id,
      "biochar-products": product.id, formulations: chain.recipe.id, suppliers: supplier.id,
      customers: chain.customer.id, orders: chain.owners.delivery.orderId!, deliveries: chain.owners.delivery.id,
      "lab-samples": chain.owners.lab_sample.id, applications: chain.owners.application.id,
    };
    for (const [family, read, operationId, idField] of families) {
      const id = ids[family];
      expect(principalAllows(api, `${family}:write`)).toBe(true);
      expect(await read(api, { id })).toEqual(await read(app, { id }));
      const first = await read(app, { id });
      const field = family === "feedstocks" ? "notes" : "code";
      const appCode = `E2E-APP-${randomUUID().slice(0, 8).toUpperCase()}`;
      await updates[operationId](app, { [idField]: id, expectedVersion: first.version, [field]: appCode });
      expect(await read(api, { id })).toMatchObject({ [field]: appCode });
      const next = await read(app, { id });
      const oauthCode = `E2E-OAUTH-${randomUUID().slice(0, 8).toUpperCase()}`;
      const restResponse = await restOperation(operationId, { [idField]: id, expectedVersion: next.version, [field]: oauthCode }, token);
      expect(restResponse.status).toBe(200);
      expect(await read(app, { id })).toMatchObject({ [field]: oauthCode });
      const mcpToken = await f.accessToken({ organizationId: chain.ctx.organizationId, memberId,
        resource: getOAuthConfig().mcp, scopes: API_SCOPES.filter(scope => !scope.endsWith(":delete")) });
      const current = await read(app, { id });
      const mcpCode = `E2E-MCP-${randomUUID().slice(0, 8).toUpperCase()}`;
      const called = await oauthRpc(mcpToken, "tools/call", { name: operationId,
        arguments: { [idField]: id, expectedVersion: current.version, [field]: mcpCode, requestKey: randomUUID() } });
      expect(called.error).toBeUndefined();
      expect(called.result.isError).toBeUndefined();
      expect(await read(app, { id })).toMatchObject({ [field]: mcpCode });
    }
    for (const owner of API_DOCUMENT_OWNER_TYPES) {
      const id = chain.owners[owner].id;
      expect(canAccessOwnerDocuments(api, owner, "read")).toBe(true);
      expect(canAccessOwnerDocuments(api, owner, "write")).toBe(true);
      await expect(assertCanManageDocumentEntity(app, API_DOCUMENT_OWNERS[owner].entityType, id)).resolves.toBeUndefined();
      await expect(assertCanManageDocumentEntity(api, API_DOCUMENT_OWNERS[owner].entityType, id)).resolves.toBeUndefined();
    }
  } finally {
    if (supplierId) await db.delete(suppliers).where(eq(suppliers.id, supplierId));
    await db.delete(applicationOutputAllocations).where(eq(applicationOutputAllocations.organizationId, chain.ctx.organizationId));
    await removeApiDocumentWriteFixture(chain);
  }
}, PARITY_TIMEOUT_MS);

// Explicit cases are checked against the registry below: additions cannot silently
// escape transport parity. Missing references deliberately reach domain checks.
const absent = "00000000-0000-4000-8000-000000000001";
const instant = "2026-09-01T12:00:00.000Z";
const location = { name: "E2E parity location", country: "TZ", gpsLatitude: 0, gpsLongitude: 0 };
const version = (field: string) => ({ [field]: absent, expectedVersion: 1 });
const parityCases = {
  add_supplier_location: { supplierId: absent, ...location },
  update_supplier_location: { supplierId: absent, locationId: absent, expectedVersion: 1, name: "E2E updated" },
  delete_supplier_location: { supplierId: absent, locationId: absent, expectedVersion: 1 },
  add_customer_location: { customerId: absent, ...location },
  update_customer_location: { customerId: absent, locationId: absent, expectedVersion: 1, name: "E2E updated" },
  delete_customer_location: { customerId: absent, locationId: absent, expectedVersion: 1 },
  archive_customer_location: { customerId: absent, locationId: absent, expectedVersion: 1 },
  restore_customer_location: { customerId: absent, locationId: absent, expectedVersion: 1 },
  create_customer: { name: "E2E parity customer", locations: [location] },
  update_customer: version("customerId"), delete_customer: version("customerId"),
  archive_customer: version("customerId"), restore_customer: version("customerId"),
  create_supplier: { name: "E2E parity supplier", locations: [location] },
  update_supplier: version("supplierId"), delete_supplier: version("supplierId"),
  archive_supplier: version("supplierId"), restore_supplier: version("supplierId"),
  create_formulation: { name: "E2E parity formulation" },
  update_formulation: version("formulationId"), delete_formulation: version("formulationId"),
  archive_formulation: version("formulationId"), restore_formulation: version("formulationId"),
  record_application: { deliveryId: absent, applicationDate: "2026-09-01", appliedWetMassKg: 1, fieldSizeHa: 1, evidenceMethod: "location", gpsLatitude: 0, gpsLongitude: 0 },
  update_application: version("applicationId"), delete_application: version("applicationId"),
  request_document_upload: { ownerType: "feedstock", ownerId: absent, documentType: "weighbridge_ticket", fileName: "parity.pdf", contentType: "application/pdf", sizeBytes: DOCUMENT_BYTES.length, sha256: DOCUMENT_SHA256 },
  record_delivery: { orderId: absent, storageLocationId: absent, deliveredAt: instant, deliveredWetMassKg: 1, moisturePercent: 10 },
  update_delivery: version("deliveryId"),
  record_order: { facilityId: absent, customerId: absent, customerLocationId: absent, formulationId: absent, orderDate: "2026-09-01", quantityKg: 1 },
  update_order: version("orderId"), delete_order: version("orderId"),
  start_production_run: { facilityId: absent, reactorId: absent, startTime: instant, status: "running", feedstockDraws: [{ storageLocationId: absent, wetMassKg: 1 }] },
  update_production_run: version("productionRunId"), delete_production_run: version("productionRunId"),
  log_feedstock_delivery: { facilityId: absent, supplierId: absent, feedstockTypeId: absent, deliveryDate: "2026-09-01", totalWetMassKg: 1, moisturePercent: 10, allocations: [{ storageLocationId: absent, allocatedWetMassKg: 1 }] },
  update_feedstock: version("feedstockId"), delete_feedstock: version("feedstockId"),
  record_output_stock_movement: { storageLocationId: absent, kind: "loss", occurredAt: instant, wetMassKg: 1, moisturePercent: 10, reason: "E2E parity loss" },
  make_biochar_product: { facilityId: absent, formulationId: absent, placedAt: instant, sourceBiocharStorageLocationId: absent, storageLocationId: absent, biocharWetMassKg: 1, biocharMoisturePercent: 10, waterAddedKg: 0 },
  update_biochar_product: version("biocharProductId"),
  record_lab_sample: { creditBatchId: absent, samplingTime: instant, totalCarbonPercent: 80, organicCarbonPercent: 78 },
  update_lab_sample: version("labSampleId"), delete_lab_sample: version("labSampleId"),
} satisfies Record<keyof typeof operationRegistry, Record<string, unknown>>;

it("has an explicit parity case for every registered operation", () => {
  expect(Object.keys(parityCases).sort()).toEqual(Object.keys(operationRegistry).sort());
});

type RouteModule = Record<string, (request: Request, route: { params: Promise<Record<string, string>> }) => Promise<Response>>;
const routeModules = import.meta.glob("../src/app/api/v1/**/route.ts") as Record<string, () => Promise<RouteModule>>;
const parentFields: Record<string, string> = {
  "storage-locations": "storageLocationId", suppliers: "supplierId", customers: "customerId", formulations: "formulationId", feedstocks: "feedstockId",
  "production-runs": "productionRunId", "biochar-products": "biocharProductId", orders: "orderId",
  deliveries: "deliveryId", "lab-samples": "labSampleId", applications: "applicationId",
};
async function restOperation(name: string, input: Record<string, unknown>, token: Awaited<ReturnType<OAuthFixture["accessToken"]>>) {
  const entry = Object.entries(openapi.paths).flatMap(([path, methods]) => Object.entries(methods)
    .filter(([, spec]) => typeof spec === "object" && "operationId" in spec && spec.operationId === (name.includes("_document_upload") ? name.replace("_document_upload", "_feedstock_document_upload") : name))
    .map(([method]) => ({ path, method }))).find(entry => !name.includes("document") || entry.path.includes("/feedstocks/"));
  if (!entry) throw new Error(`No REST operation for ${name}`);
  const params: Record<string, string> = {};
  const body = { ...input };
  const family = entry.path.split("/")[1];
  const path = entry.path.replace(/\{([^}]+)\}/g, (_match, param: string) => {
    const field = param === "locationId" ? "locationId" : param === "documentId" ? "documentId" : parentFields[family];
    params[param] = String(input[field] ?? input.ownerId ?? absent);
    delete body[field];
    return params[param];
  });
  delete body.ownerType; delete body.ownerId;
  const expectedVersion = body.expectedVersion;
  delete body.expectedVersion;
  const headers = new Headers(token.request().headers);
  headers.set("content-type", "application/json"); headers.set("Idempotency-Key", randomUUID());
  if (expectedVersion) {
    const entity = entry.path.includes("/locations/") ? `${family.slice(0, -1)}_location` : parentFields[family].replace(/Id$/, "").replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const revision = revisions[`${entity.toUpperCase()}_REPRESENTATION_REVISION` as keyof typeof revisions];
    if (typeof revision !== "number") throw new Error(`No revision for ${entity}`);
    headers.set("If-Match", `"${expectedVersion}.${revision}"`);
  }
  const request = new Request(token.request(`/api/v1${path}`), { method: entry.method.toUpperCase(), headers, body: JSON.stringify(body) });
  const refused = await guardApiMethod(request);
  if (refused) return refused;
  const modulePath = `../src/app/api/v1${entry.path.replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`;
  const load = routeModules[modulePath];
  if (!load) throw new Error(`No route module ${modulePath}`);
  return (await load())[entry.method.toUpperCase()](request, { params: Promise.resolve(params) });
}
async function oauthRpc(token: Awaited<ReturnType<OAuthFixture["accessToken"]>>, method: string, params = {}) {
  const headers = new Headers(token.request().headers);
  headers.set("content-type", "application/json"); headers.set("accept", "application/json, text/event-stream");
  headers.set("mcp-protocol-version", "2025-06-18");
  const response = await MCP(new Request(token.request("/api/mcp"), { method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  expect(response.status).toBe(200);
  return rpcBody(response);
}

it.each(Object.keys(operationRegistry) as (keyof typeof operationRegistry)[])("%s crosses REST and MCP with a real Member bearer", async name => {
  const input = parityCases[name];
  const operation = operationRegistry[name] as Operation<z.ZodType, unknown>;
  expect(operation.input.safeParse(input).success, name).toBe(true);
  const scopes = API_SCOPES.filter(scope => !scope.endsWith(":delete"));
  const rest = await f.accessToken({ scopes });
  const mcp = await f.accessToken({ scopes, resource: getOAuthConfig().mcp });
  const listing = await oauthRpc(mcp, "tools/list");
  const names = listing.result.tools.map((tool: { name: string }) => tool.name);
  // The app runs first: a create that succeeds there makes the same input a
  // duplicate for REST and MCP, which then answer conflict, never a role refusal.
  const app = name.startsWith("delete_") ? undefined : await outcome(() => runOperationInProcess(operation, f.ctx, input));
  const response = await restOperation(name, input, rest);
  const called = await oauthRpc(mcp, "tools/call", { name, arguments: { ...input, requestKey: randomUUID() } });
  if (!app) {
    // Q92 intentionally excludes deletes even where the app Member can delete.
    expect(names).not.toContain(name);
    expect(response.status).toBe(403);
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect(called.error).toMatchObject({ message: "Unknown tool." });
    return;
  }
  expect(names).toContain(name);
  if (app.ok && name.startsWith("create_")) {
    const body = await response.json();
    expect(response.status === 409 ? body.code : response.status).toSatisfy((value: unknown) => value === "conflict" || (typeof value === "number" && value >= 200 && value < 300));
    expect(called.error).toBeUndefined();
    if (called.result.isError) expect(called.result.structuredContent).toMatchObject({ code: "conflict" });
  } else if (app.ok) {
    expect(response.status).toBeGreaterThanOrEqual(200); expect(response.status).toBeLessThan(300);
    expect(called.error).toBeUndefined(); expect(called.result.isError).toBeUndefined();
  } else {
    expect(app.code).not.toBe("forbidden"); expect(app.code).not.toBe("validation_failed");
    expect(await response.json()).toMatchObject({ code: app.code });
    expect(called.result.structuredContent).toMatchObject({ code: app.code });
  }
}, PARITY_TIMEOUT_MS);

it("confirm_document_upload reaches the app Member boundary through both transports", async () => {
  const input = { ownerType: "feedstock" as const, ownerId: absent, documentId: absent };
  const app = mapConfirmOutcome(await confirmDocumentUpload(f.ctx, input, { deadlineAt: Date.now() + PARITY_TIMEOUT_MS }));
  expect(app.status).toBe(404);
  const rest = await f.accessToken();
  const mcp = await f.accessToken({ resource: getOAuthConfig().mcp });
  const listing = await oauthRpc(mcp, "tools/list");
  expect(listing.result.tools.map((tool: { name: string }) => tool.name)).toContain("confirm_document_upload");
  const response = await restOperation("confirm_document_upload", input, rest);
  expect(response.status).toBe(app.status);
  const called = await oauthRpc(mcp, "tools/call", { name: "confirm_document_upload", arguments: input });
  expect(called.result.structuredContent).toMatchObject({ code: "not_found" });
});

it.each([
  ["supplier", readApiSupplier], ["customer", readApiCustomer], ["formulation", readApiFormulation],
] as const)("%s archive and restore succeed for a Member in the app, REST and MCP", async (entity, read) => {
  const createId = `create_${entity}` as const;
  const create = operationRegistry[createId] as Operation<z.ZodType, Record<string, { id: string }>>;
  const saved = await runOperationInProcess(create, f.ctx, parityCases[createId]);
  const id = saved[entity].id;
  const scopes = API_SCOPES.filter(scope => !scope.endsWith(":delete"));
  const rest = await f.accessToken({ scopes });
  const mcp = await f.accessToken({ scopes, resource: getOAuthConfig().mcp });
  for (const transport of ["app", "rest", "mcp"]) {
    for (const action of ["archive", "restore"] as const) {
      const name = `${action}_${entity}` as const;
      const row = await read(f.ctx, { id });
      const input = { [`${entity}Id`]: id, expectedVersion: row.version };
      if (transport === "app") await runOperationInProcess(operationRegistry[name] as Operation<z.ZodType, unknown>, f.ctx, input);
      else if (transport === "rest") expect((await restOperation(name, input, rest)).status).toBe(200);
      else {
        const called = await oauthRpc(mcp, "tools/call", { name, arguments: { ...input, requestKey: randomUUID() } });
        expect(called.error).toBeUndefined(); expect(called.result.isError).toBeUndefined();
      }
      expect((await read(f.ctx, { id })).version).toBeGreaterThan(row.version);
    }
  }
}, PARITY_TIMEOUT_MS);
