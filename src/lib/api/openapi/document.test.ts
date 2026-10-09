import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { API_BODY_MAX_BYTES, API_CURSOR_MAX_LENGTH, API_IDEMPOTENCY_KEY_MAX_LENGTH, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, API_QUERY_MAX_LENGTH } from "@/config/api-rest";
import { createFeedstockSchema, updateFeedstockSchema } from "@/schemas/feedstocks";
import { toOperationJsonSchema, type JsonSchema } from "@/lib/operations/json-schema";
import { buildOpenApiDocument, serializeOpenApiDocument } from "./document";
import { parseIfMatch, representationEtag, STRONG_ETAG_PATTERN } from "../etag";
import { IDEMPOTENCY_KEY_PATTERN, readIdempotencyKey } from "../request-body";

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
  expect(serializeOpenApiDocument().split("\n").length).toBeLessThan(1000);
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
  for (const [path, singular] of [["feedstocks", "feedstock"], ["facilities", "facility"], ["suppliers", "supplier"], ["feedstock-types", "feedstock_type"], ["storage-locations", "storage_location"], ["vehicles", "vehicle"], ["drivers", "driver"]]) {
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
  expect(lists).toHaveLength(10);
  for (const operation of lists) {
    const parameters = operation.parameters as { name: string; in: string; required: boolean; schema: JsonSchema }[];
    const query = Object.fromEntries(parameters.filter((parameter) => parameter.in === "query").map((parameter) => [parameter.name, parameter]));
    expect(query.limit).toMatchObject({ required: false, schema: { type: "integer", minimum: 1, maximum: API_LIST_MAX_LIMIT, default: API_LIST_DEFAULT_LIMIT } });
    expect(query.limit.schema).not.toHaveProperty("pattern");
    expect(query.cursor).toMatchObject({ required: false, schema: { type: "string", maxLength: API_CURSOR_MAX_LENGTH } });
    if (operation.operationId !== "find_production_runs") expect(query.q).toMatchObject({ required: false, schema: { type: "string", maxLength: API_QUERY_MAX_LENGTH } });
    if (operation.operationId !== "find_supplier_locations") {
      expect(query.code).toMatchObject({ required: false, schema: { type: "string", maxLength: API_QUERY_MAX_LENGTH } });
    }
  }
});

it("requires preconditions and documents conditional create idempotency with possible response statuses and headers", () => {
  for (const method of ["patch", "delete"]) {
    const op = document.paths["/feedstocks/{idOrCode}"][method];
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "If-Match", in: "header", required: true }));
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: false }));
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "dryRun", in: "query" }));
  }
  expect(document.paths["/feedstocks"].post.parameters).toContainEqual(expect.objectContaining({
    name: "Idempotency-Key", in: "header", required: false,
    description: expect.stringContaining("Required for creates unless dryRun=true"),
  }));
  expect(Object.keys(document.paths["/feedstocks/{idOrCode}"].delete.responses).sort()).toEqual(["200", "204", "400", "401", "403", "404", "409", "412", "413", "415", "422", "428", "429", "500", "503"]);
  expect(Object.keys(document.paths["/me"].get.responses).sort()).toEqual(["200", "401", "403", "404", "429", "500"]);
  expect(Object.keys(document.paths["/facilities"].get.responses).sort()).toEqual(["200", "400", "401", "403", "429", "500"]);
  const response = (path: string) => document.paths[path].get.responses["200"] as { headers: Record<string, unknown> };
  expect(response("/facilities/{idOrCode}").headers).toHaveProperty("ETag");
  expect(response("/drivers/{idOrCode}").headers).toHaveProperty("ETag");
  expect(response("/vehicles/{idOrCode}").headers).toHaveProperty("ETag");
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
  for (const tag of [representationEtag(42, 3), '"0.1"', '"01.1"', '"1.0"', 'W/"1.1"', "*", '"1.1", "2.1"']) {
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
    if (name === "FeedstockProblem412" || name === "ProductionRunProblem412") continue;
    expect(response.content["application/problem+json"].schema).toEqual({ $ref: "#/components/schemas/Problem" });
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
