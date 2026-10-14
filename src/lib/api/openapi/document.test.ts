import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { API_BODY_MAX_BYTES, API_CURSOR_MAX_LENGTH, API_IDEMPOTENCY_KEY_MAX_LENGTH, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, API_QUERY_MAX_LENGTH } from "@/config/api-rest";
import { recordOrderInput, updateOrderApiInput } from "@/schemas/order-input";
import { createFeedstockSchema, updateFeedstockSchema } from "@/schemas/feedstocks";
import { toOperationJsonSchema, type JsonSchema } from "@/lib/operations/json-schema";
import { buildOpenApiDocument, serializeOpenApiDocument } from "./document";
import { BODY_HASH_ETAG_PATTERN, parseIfMatch, representationEtag, STRONG_ETAG_PATTERN } from "../etag";
import { IDEMPOTENCY_KEY_PATTERN, readIdempotencyKey } from "../request-body";
import { OUTPUT_BIN_STOCK_ETAG, OUTPUT_BIN_STOCK_SOURCES } from "@/lib/operations/agent-guidance";
import { biocharStockGuide } from "../llms-guide";

const document = buildOpenApiDocument();
const routeRoot = join(process.cwd(), "src/app/api/v1");
function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? routeFiles(join(directory, entry.name)) : entry.name === "route.ts" ? [join(directory, entry.name)] : [],
  );
}
function visit(value: unknown, inspect: (node: JsonSchema) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((child) => visit(child, inspect));
  const node = value as JsonSchema;
  inspect(node);
  Object.values(node).forEach((child) => visit(child, inspect));
}

it("is deterministic and exactly matches the committed contract", () => {
  expect(buildOpenApiDocument()).toEqual(document);
  expect(serializeOpenApiDocument()).toBe(serializeOpenApiDocument());
  expect(readFileSync("openapi/v1.json", "utf8")).toBe(serializeOpenApiDocument());
  expect(JSON.parse(serializeOpenApiDocument())).toEqual(document);
});

it("covers every exported v1 route method, with unique operation ids", () => {
  const actual: string[] = [];
  for (const file of routeFiles(routeRoot)) {
    const path = "/" + relative(routeRoot, file).replace(/\/route\.ts$/, "").replace(/\[([^\]]+)\]/g, "{$1}");
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PATCH|DELETE|PUT|HEAD|OPTIONS)\b/g)) {
      actual.push(`${match[1].toLowerCase()} ${path}`);
      expect(document.paths[path]?.[match[1].toLowerCase()], `${match[1]} ${path}`).toBeDefined();
    }
  }
  const published = Object.entries(document.paths).flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method} ${path}`));
  expect(published.sort()).toEqual(actual.sort());
  const ids = Object.values(document.paths).flatMap((methods) => Object.values(methods).map((operation) => operation.operationId));
  expect(new Set(ids).size).toBe(ids.length);
  expect(document.paths["/feedstocks"].post.operationId).toBe("log_feedstock_delivery");
  expect(document.paths["/feedstocks/{idOrCode}"].patch.operationId).toBe("update_feedstock");
  expect(document.paths["/feedstocks/{idOrCode}"].delete.operationId).toBe("delete_feedstock");
  expect(document.paths["/me"].get.operationId).toBe("whoami");
  expect(document.paths["/suppliers/{idOrCode}/locations"].get.operationId).toBe("find_supplier_locations");
  for (const [path, singular] of [["feedstocks", "feedstock"], ["facilities", "facility"], ["suppliers", "supplier"], ["customers", "customer"], ["orders", "order"], ["feedstock-types", "feedstock_type"], ["storage-locations", "storage_location"], ["vehicles", "vehicle"], ["drivers", "driver"]]) {
    expect(document.paths[`/${path}`].get.operationId).toBe(`find_${path.replaceAll("-", "_")}`);
    expect(document.paths[`/${path}/{idOrCode}`].get.operationId).toBe(`get_${singular}`);
  }
  expect(document.paths["/openapi.json"].get.operationId).toBe("get_openapi_document");
  expect(document.paths["/llms.txt"].get.operationId).toBe("get_llms_guide");
});

it("describes every schema property, including nested allocations, errors and envelopes", () => {
  visit(document, (node) => {
    if (!node.properties) return;
    for (const [key, field] of Object.entries(node.properties as Record<string, JsonSchema>)) {
      expect(field.description, `Description for ${key}`).toEqual(expect.any(String));
      expect(field.description, key).not.toBe("");
    }
  });
});

it("describes every enum, including nullable input evidence and header values", () => {
  visit(document, (node) => {
    if (node.enum) expect(node.description).toEqual(expect.any(String));
  });
});

it("publishes business dates as date, and preserves operation input types and constraints", () => {
  const create = document.paths["/feedstocks"].post.requestBody as { content: { "application/json": { schema: JsonSchema; example: unknown } } };
  const properties = create.content["application/json"].schema.properties as Record<string, JsonSchema>;
  expect(properties.deliveryDate).toMatchObject({ type: "string", format: "date" });
  expect(properties.totalWetMassKg).toMatchObject({ type: "number", exclusiveMinimum: 0 });
  expect(properties.allocations).toMatchObject({ minItems: 1, maxItems: 200, items: { additionalProperties: false } });
  expect(createFeedstockSchema.safeParse(create.content["application/json"].example).success).toBe(true);
  expect(properties.transportDistanceSource).toMatchObject({ anyOf: [{ type: "string", enum: ["map_estimate", "manual", "document"] }, { type: "null" }] });
  expect(document.components.schemas.feedstock.properties).toMatchObject({ deliveryDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] } });
  const patch = document.paths["/feedstocks/{idOrCode}"].patch.requestBody as typeof create;
  const expected = toOperationJsonSchema(updateFeedstockSchema.omit({ feedstockId: true, expectedVersion: true }));
  expect(patch.content["application/json"].schema.properties).toEqual(expected.properties);
  expect(toOperationJsonSchema(createFeedstockSchema).properties).toMatchObject({ deliveryDate: { format: "date" } });
});

it("publishes pagination and search bounds on every list route", () => {
  const lists = Object.values(document.paths).map((methods) => methods.get)
    .filter((operation) => operation?.operationId.startsWith("find_"));
  expect(lists).toHaveLength(18);
  for (const operation of lists) {
    const parameters = operation.parameters as { name: string; in: string; required: boolean; schema: JsonSchema }[];
    const query = Object.fromEntries(parameters.filter((parameter) => parameter.in === "query").map((parameter) => [parameter.name, parameter]));
    expect(query.limit).toMatchObject({ required: false, schema: { type: "integer", minimum: 1, maximum: API_LIST_MAX_LIMIT, default: API_LIST_DEFAULT_LIMIT } });
    expect(query.limit.schema).not.toHaveProperty("pattern");
    expect(query.cursor).toMatchObject({ required: false, schema: { type: "string", maxLength: API_CURSOR_MAX_LENGTH } });
    if (operation.operationId === "find_output_stock_movements") {
      expect(Object.keys(query).sort()).toEqual(["cursor", "limit"]);
      continue;
    }
    if (operation.operationId !== "find_production_runs") expect(query.q).toMatchObject({ required: false, schema: { type: "string", maxLength: API_QUERY_MAX_LENGTH } });
    if (!["find_supplier_locations", "find_customer_locations"].includes(operation.operationId)) {
      expect(query.code).toMatchObject({ required: false, schema: { type: "string", maxLength: API_QUERY_MAX_LENGTH } });
    }
  }
});

it("requires preconditions and requires create idempotency with possible response statuses and headers", () => {
  for (const method of ["patch", "delete"]) {
    const op = document.paths["/feedstocks/{idOrCode}"][method];
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "If-Match", in: "header", required: true }));
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: false }));
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "dryRun", in: "query" }));
  }
  expect(document.paths["/feedstocks"].post.parameters).toContainEqual(expect.objectContaining({
    name: "Idempotency-Key", in: "header", required: true,
    description: expect.stringContaining("Required on every create, including dry runs; a dry run never consumes it."),
  }));
  expect(Object.keys(document.paths["/feedstocks/{idOrCode}"].delete.responses).sort()).toEqual(["200", "204", "400", "401", "403", "404", "409", "412", "413", "415", "422", "428", "429", "500", "503"]);
  expect(Object.keys(document.paths["/me"].get.responses).sort()).toEqual(["200", "401", "403", "404", "429", "500"]);
  expect(Object.keys(document.paths["/facilities"].get.responses).sort()).toEqual(["200", "400", "401", "403", "429", "500"]);
  const response = (path: string) => document.paths[path].get.responses["200"] as { headers: Record<string, unknown> };
  expect(response("/facilities/{idOrCode}").headers).toHaveProperty("ETag");
  expect(response("/drivers/{idOrCode}").headers).toHaveProperty("ETag");
  expect(response("/vehicles/{idOrCode}").headers).toHaveProperty("ETag");
  expect(response("/biochar-products/{idOrCode}").headers).toHaveProperty("ETag");
  expect(response("/formulations/{idOrCode}").headers).toHaveProperty("ETag");
  expect(Object.keys(document.paths["/storage-locations/{idOrCode}/stock-movements"].get.responses).sort()).toEqual(["200", "400", "401", "403", "404", "422", "429", "500"]);
  expect(document.paths["/storage-locations/{idOrCode}/stock-movements"].get["x-required-scope"]).toBe("biochar-products:read");
});

it("publishes output bin stock with a body-hash ETag and only the facility query", () => {
  const operation = document.paths["/storage-locations/{idOrCode}/stock"].get;
  expect(operation).toMatchObject({ operationId: "get_bin_stock", "x-required-scope": "biochar-products:read" });
  expect(Object.keys(operation.responses).sort()).toEqual(["200", "400", "401", "403", "404", "422", "429", "500"]);
  expect(operation.parameters?.map((parameter) => (parameter as { name: string }).name)).toEqual(["idOrCode", "facilityId"]);
  const response = operation.responses["200"] as { headers: Record<string, unknown>; content: object };
  const pattern = BODY_HASH_ETAG_PATTERN.source;
  expect(response.headers).toMatchObject({ ETag: { schema: { type: "string", pattern } } });
  expect(response.headers.ETag).not.toHaveProperty("$ref");
  expect(document.components.headers.ETag.schema).toMatchObject({ pattern: STRONG_ETAG_PATTERN.source });
  const stock = document.components.schemas.output_bin_stock;
  expect(stock.properties).toHaveProperty("subBins");
  for (const field of ["at", "evaluatedAt", "basisFingerprint", "recentMovements"]) expect(stock.properties).not.toHaveProperty(field);
  for (const guidance of [OUTPUT_BIN_STOCK_ETAG, OUTPUT_BIN_STOCK_SOURCES]) {
    expect(operation.description).toContain(guidance);
    expect(biocharStockGuide).toContain(guidance);
    expect(guidance).not.toMatch(/[–—]/);
  }
  expect(response.headers.ETag).toMatchObject({ description: `Hash of the published stock. ${OUTPUT_BIN_STOCK_ETAG}` });
});

it("accepts an optional empty DELETE object and publishes its body errors", () => {
  const operation = document.paths["/feedstocks/{idOrCode}"].delete;
  expect(operation.requestBody).toEqual({
    required: false,
    description: `Optional; when sent it must be an empty JSON object, maximum ${API_BODY_MAX_BYTES} bytes.`,
    content: { "application/json": { schema: { type: "object", properties: {}, additionalProperties: false }, example: {} } },
  });
  expect(operation.description).toContain("Malformed JSON returns 400; unknown fields and other JSON values return 422.");
  for (const status of [400, 413, 415, 422]) {
    expect(operation.responses[status]).toEqual({ $ref: `#/components/responses/Problem${status}` });
  }
});

it("omits dry-run ETags while allowing the conditional PATCH header", () => {
  const response = (path: string, method: string, status: string) => document.paths[path][method].responses[status] as {
    description: string; headers: Record<string, JsonSchema>;
  };
  expect(response("/feedstocks", "post", "200").headers).not.toHaveProperty("ETag");
  expect(response("/feedstocks", "post", "201").headers.ETag).toEqual({ $ref: "#/components/headers/ETag" });
  expect(response("/feedstocks/{idOrCode}", "delete", "200").headers).not.toHaveProperty("ETag");
  const patch = response("/feedstocks/{idOrCode}", "patch", "200");
  expect(patch.description).toContain("ETag is absent on dry runs.");
  expect(patch.headers.ETag).toEqual({ $ref: "#/components/headers/ETag" });
  expect(document.components.headers.ETag).not.toHaveProperty("required", true);
});

it("publishes correlation headers on both public discovery responses", () => {
  for (const path of ["/openapi.json", "/llms.txt"]) {
    expect(document.paths[path].get.responses["200"]).toMatchObject({
      headers: { "X-Request-Id": { $ref: "#/components/headers/X-Request-Id" } },
    });
  }
});

it("publishes the runtime header patterns and idempotency length bound", () => {
  const parameters = document.paths["/feedstocks/{idOrCode}"].patch.parameters as { name: string; schema: JsonSchema }[];
  const idempotency = parameters.find((parameter) => parameter.name === "Idempotency-Key")!.schema;
  expect(idempotency).toMatchObject({ minLength: 1, maxLength: API_IDEMPOTENCY_KEY_MAX_LENGTH, pattern: IDEMPOTENCY_KEY_PATTERN.source });
  const keyPattern = new RegExp(idempotency.pattern as string);
  for (const key of ["delivery-B2:retry_1", "!~", "contains space", "é", ""]) {
    const request = new Request("https://example.test", { headers: { "Idempotency-Key": key } });
    if (keyPattern.test(key)) expect(readIdempotencyKey(request, true)).toBe(key);
    else expect(() => readIdempotencyKey(request, true)).toThrow();
  }
  const ifMatch = parameters.find((parameter) => parameter.name === "If-Match")!.schema;
  expect(ifMatch.pattern).toBe(STRONG_ETAG_PATTERN.source);
  expect(document.components.headers.ETag.schema).toMatchObject({ pattern: STRONG_ETAG_PATTERN.source });
  const etagPattern = new RegExp(ifMatch.pattern as string);
  for (const tag of [representationEtag(42, 3), '"0.1"', '"01.1"', '"1.0"', 'W/"1.1"', "*", '"1.1", "2.1"', '"78.86753729017096108"', '"9007199254740992.1"']) {
    if (etagPattern.test(tag)) expect(parseIfMatch(tag)).toEqual({ version: 42, revision: 3 });
    else expect(() => parseIfMatch(tag)).toThrow();
  }
});

it("types current as a feedstock only on feedstock precondition responses", () => {
  const preconditionRef = { $ref: "#/components/responses/FeedstockProblem412" };
  for (const method of ["patch", "delete"]) {
    const responses = document.paths["/feedstocks/{idOrCode}"][method].responses;
    expect(responses["412"]).toEqual(preconditionRef);
    expect(responses["422"]).toEqual({ $ref: "#/components/responses/Problem422" });
  }
  expect(document.components.responses.FeedstockProblem412.content["application/problem+json"].schema)
    .toEqual({ $ref: "#/components/schemas/FeedstockPreconditionProblem" });
  expect(document.components.schemas.FeedstockPreconditionProblem.allOf).toEqual([
    { $ref: "#/components/schemas/Problem" },
    expect.objectContaining({ properties: { current: expect.objectContaining({ $ref: "#/components/schemas/feedstock" }) }, required: ["current"] }),
  ]);
  for (const [name, response] of Object.entries(document.components.responses)) {
    if (name === "FeedstockProblem412" || name === "ProductionRunProblem412" || name === "BiocharProductProblem412" || name === "LabSampleProblem412" || name === "OrderProblem412") continue;
    expect(response.content["application/problem+json"].schema).toEqual({ $ref: "#/components/schemas/Problem" });
  }
});

it("describes a shared path-level 405 honestly without adding it to supported operations", () => {
  expect(document.components.responses.Problem405).toMatchObject({
    headers: { Allow: { $ref: "#/components/headers/Allow" } },
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  });
  expect(document.components.headers.Allow.description).toContain("Always present on 405");
  expect(document.info.description).toContain("path-level refusal");
  for (const methods of Object.values(document.paths)) {
    for (const operation of Object.values(methods)) expect(operation.responses).not.toHaveProperty("405");
  }
});

describe("OpenAPI 3.1 structure (no validator dependency)", () => {
  it("defines info, relative servers, HTTP bearer security and explicit scope metadata", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.version).toBe("1.0.0");
    expect(document.servers).toEqual([{ url: "/api/v1" }]);
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    for (const [path, methods] of Object.entries(document.paths)) {
      expect(path).toMatch(/^\//);
      for (const operation of Object.values(methods)) {
        expect(operation.operationId).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(operation.description).toBeTruthy();
        expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
        if (operation["x-required-scope"]) expect(operation.description).toContain(operation["x-required-scope"]);
        const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
        for (const name of placeholders) expect(operation.parameters).toContainEqual(expect.objectContaining({ name, in: "path", required: true }));
        for (const [status, response] of Object.entries(operation.responses)) {
          expect(status).toMatch(/^[1-5][0-9]{2}$/);
          const ref = (response as JsonSchema).$ref;
          const resolved = typeof ref === "string" ? document.components.responses[ref.split("/").at(-1)!] : response;
          expect(resolved).toHaveProperty("description");
        }
      }
    }
  });
  it("resolves all local references and uses 3.1 nullable schemas", () => {
    visit(document, (node) => {
      expect(node).not.toHaveProperty("nullable");
      if (typeof node.$ref === "string") {
        expect(node.$ref).toMatch(/^#\/components\/(schemas|responses|headers)\//);
        const resolved = node.$ref.slice(2).split("/").reduce<unknown>((current, key) =>
          current && typeof current === "object" ? (current as JsonSchema)[key] : undefined, document);
        expect(resolved, node.$ref).toBeDefined();
      }
      if (Array.isArray(node.required) && node.properties) {
        for (const name of node.required) expect(node.properties).toHaveProperty(String(name));
      }
    });
    expect(z.toJSONSchema(createFeedstockSchema, { io: "input", unrepresentable: "any" })).not.toEqual(toOperationJsonSchema(createFeedstockSchema));
  });
});

it("publishes scopes as an extensible response vocabulary without widening runtime permissions", () => {
  const scopes = document.components.schemas.me.properties as Record<string, JsonSchema>;
  expect(scopes.scopes.items).not.toHaveProperty("enum");
  expect(scopes.scopes.items).toMatchObject({ type: "string", "x-extensible-enum": expect.arrayContaining(["production-runs:read", "production-runs:write", "production-runs:delete", "reactors:read"]) });
});

it("keeps production run representations unexpanded so their ETags cover every returned field", () => {
  const run = document.components.schemas.production_run;
  expect(run.properties).toMatchObject({ facilityId: { type: "string" }, reactorId: { type: "string" },
    biocharStorageLocationId: expect.any(Object) });
  for (const field of ["facilityCode", "timeZone", "reactorCode", "biocharStorageLocationCode"]) {
    expect(run.properties).not.toHaveProperty(field);
    expect(run.required).not.toContain(field);
  }
  const fields = run.properties as Record<string, JsonSchema>;
  const draw = fields.feedstockDraws.items as JsonSchema;
  expect(draw.properties).toHaveProperty("storageLocationId");
  expect(draw.properties).not.toHaveProperty("storageLocationCode");
});

it("publishes the product and movement writes with one scope, required keys and no deletion", () => {
  const writes = [
    document.paths["/biochar-products"].post, document.paths["/biochar-products/{idOrCode}"].patch,
    document.paths["/storage-locations/{idOrCode}/stock-movements"].post,
  ];
  expect(writes.map((operation) => operation.operationId)).toEqual(["make_biochar_product", "update_biochar_product", "record_output_stock_movement"]);
  for (const operation of writes) expect(operation["x-required-scope"]).toBe("biochar-products:write");
  expect(document.paths["/biochar-products/{idOrCode}"]).not.toHaveProperty("delete");
  for (const operation of [writes[0], writes[2]]) {
    expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: true }));
    expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining(["200", "201", "404", "409", "422"]));
  }
  expect(writes[1].responses["412"]).toEqual({ $ref: "#/components/responses/BiocharProductProblem412" });
  expect(writes[1].parameters).toContainEqual(expect.objectContaining({ name: "If-Match", required: true }));
  type BodySchema = { properties: Record<string, JsonSchema> };
  const bodyOf = (operation: (typeof writes)[number]) => (operation.requestBody as { content: { "application/json": { schema: BodySchema } } }).content["application/json"].schema;
  const movementBody = bodyOf(writes[2]);
  expect(movementBody.properties.kind.enum).toEqual(["loss", "count"]);
  for (const forbidden of ["storageLocationId", "correctsMovementId", "expectedProductVersions", "idempotencyKey"]) expect(movementBody.properties).not.toHaveProperty(forbidden);
  const productBody = bodyOf(writes[0]);
  for (const forbidden of ["code", "idempotencyKey", "expectedProductVersions"]) expect(productBody.properties).not.toHaveProperty(forbidden);
  expect(document.components.schemas.Problem.properties).toHaveProperty("preview");
});

it("publishes lab sample and credit batch reads with their own scopes, and lab sample writes with theirs", () => {
  expect(document.paths["/lab-samples"].get).toMatchObject({ operationId: "find_lab_samples", "x-required-scope": "lab-samples:read" });
  expect(document.paths["/lab-samples/{idOrCode}"].get).toMatchObject({ operationId: "get_lab_sample", "x-required-scope": "lab-samples:read" });
  expect(document.paths["/credit-batches"].get).toMatchObject({ operationId: "find_credit_batches", "x-required-scope": "credit-batches:read" });
  expect(document.paths["/credit-batches/{idOrCode}"].get).toMatchObject({ operationId: "get_credit_batch", "x-required-scope": "credit-batches:read" });
  expect(document.paths["/lab-samples/{idOrCode}"].get.responses["200"]).toMatchObject({ headers: { ETag: expect.any(Object) } });
  const sample = document.components.schemas.lab_sample.properties as Record<string, JsonSchema>;
  for (const field of ["facilityId", "durabilityOption", "creditBatchCode", "productionRunId", "timeZone"]) expect(sample).not.toHaveProperty(field);
  expect(Object.keys(document.components.schemas.credit_batch.properties as object).sort()).toEqual(
    ["archivedAt", "code", "createdAt", "endDate", "facilityId", "feedstockTypeId", "id", "sampling", "startDate", "status", "updatedAt", "version"]);
  expect(document.components.schemas.facility.properties).toHaveProperty("durabilityOption");
  expect(document.paths["/credit-batches"]).not.toHaveProperty("post");
  expect(document.paths["/lab-samples"].post).toMatchObject({ operationId: "record_lab_sample", "x-required-scope": "lab-samples:write" });
  expect(document.paths["/lab-samples/{idOrCode}"].patch).toMatchObject({ operationId: "update_lab_sample", "x-required-scope": "lab-samples:write" });
  expect(document.paths["/lab-samples/{idOrCode}"].delete).toMatchObject({ operationId: "delete_lab_sample", "x-required-scope": "lab-samples:delete" });
  expect(document.paths["/lab-samples/batch"]).toBeUndefined();
  const patch = document.paths["/lab-samples/{idOrCode}"].patch;
  expect(patch.responses["412"]).toEqual({ $ref: "#/components/responses/LabSampleProblem412" });
  expect(Object.keys(patch.responses)).toContain("428");
  const patchProperties = (patch.requestBody as { content: { "application/json": { schema: { properties: object } } } }).content["application/json"].schema.properties;
  for (const forbidden of ["labSampleId", "expectedVersion", "hToCOrgRatio"]) expect(patchProperties).not.toHaveProperty(forbidden);
  expect(patchProperties).toHaveProperty("creditBatchId");
});

it("publishes customer, destination, stored order and snapshot balance reads", () => {
  for (const [path, operationId, scope] of [
    ["/customers", "find_customers", "customers:read"], ["/customers/{idOrCode}", "get_customer", "customers:read"],
    ["/customers/{idOrCode}/locations", "find_customer_locations", "customers:read"],
    ["/orders", "find_orders", "orders:read"], ["/orders/{idOrCode}", "get_order", "orders:read"], ["/orders/{idOrCode}/balance", "get_order_balance", "orders:read"],
  ]) {
    if (path !== "/orders" && path !== "/orders/{idOrCode}") expect(Object.keys(document.paths[path])).toEqual(["get"]);
    expect(document.paths[path].get).toMatchObject({ operationId, "x-required-scope": scope });
    for (const status of ["400", "401", "403", "429", "500"]) expect(document.paths[path].get.responses).toHaveProperty(status);
  }
  expect(document.paths["/orders"].get.responses).toHaveProperty("404");
  for (const [name, fields] of [
    ["customer", ["id", "code", "name", "version", "createdAt", "updatedAt"]],
    ["customer_location", ["id", "customerId", "name", "gpsLatitude", "gpsLongitude", "distanceFromFacilityKm", "distanceSource", "isDefault", "version", "createdAt", "updatedAt"]],
    ["order", ["id", "code", "version", "facilityId", "customerId", "customerLocationId", "formulationId", "orderDate", "quantityKg", "packaging", "archivedAt", "createdAt", "updatedAt"]],
    ["order_balance", ["orderId", "quantityKg", "deliveredWetMassKg", "remainingWetMassKg", "fulfillmentStatus"]],
  ] as const) expect(Object.keys(document.components.schemas[name].properties!).sort()).toEqual([...fields].sort());
  const op = document.paths["/orders/{idOrCode}/balance"].get;
  expect(op.parameters?.map((parameter) => (parameter as { name: string }).name)).toEqual(["idOrCode"]);
  expect(op.responses["200"]).toMatchObject({ headers: { ETag: { schema: { pattern: BODY_HASH_ETAG_PATTERN.source } }, "Cache-Control": { schema: { enum: ["private, no-store"] } } } });
  expect(document.components.schemas.order.properties).toMatchObject({ orderDate: { type: "string", format: "date" }, quantityKg: { description: expect.stringContaining("32-bit") } });
  expect(document.components.schemas.storage_location.required).toContain("formulationId");
  expect(document.paths["/storage-locations"].get.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "type" }), expect.objectContaining({ name: "formulationId" })]));
});

it("publishes order write bodies, scopes, preconditions and complete problem responses", () => {
  for (const [path, method, id, scope] of [
    ["/orders", "post", "record_order", "orders:write"],
    ["/orders/{idOrCode}", "patch", "update_order", "orders:write"],
    ["/orders/{idOrCode}", "delete", "delete_order", "orders:delete"],
  ]) {
    const operation = document.paths[path][method];
    expect(operation).toMatchObject({ operationId: id, "x-required-scope": scope });
    const errors = [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503];
    if (method !== "post") errors.push(412, 428);
    for (const status of errors) expect(operation.responses).toHaveProperty(String(status));
    expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: method === "post" }));
    if (method !== "post") {
      expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "If-Match", required: true }));
      expect(operation.responses["412"]).toEqual({ $ref: "#/components/responses/OrderProblem412" });
    }
  }
  expect(document.components.schemas.OrderPreconditionProblem.allOf).toContainEqual(expect.objectContaining({
    properties: { current: expect.objectContaining({ $ref: "#/components/schemas/order" }) }, required: ["current"],
  }));
  const bodyOf = (method: string, path = "/orders/{idOrCode}") => (document.paths[path][method].requestBody as {
    content: { "application/json": { schema: JsonSchema } };
  }).content["application/json"].schema;
  for (const [actual, input] of [[bodyOf("post", "/orders"), recordOrderInput], [bodyOf("patch"), updateOrderApiInput]] as const) {
    const expected = toOperationJsonSchema(input);
    delete expected.$schema;
    expect(actual).toEqual(expected);
  }
  expect(bodyOf("delete")).toEqual({ type: "object", properties: {}, additionalProperties: false });
});
