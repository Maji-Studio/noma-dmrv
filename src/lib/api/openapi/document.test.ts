import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFeedstockSchema, updateFeedstockSchema } from "@/schemas/feedstocks";
import { toOperationJsonSchema, type JsonSchema } from "@/lib/operations/json-schema";
import { buildOpenApiDocument, serializeOpenApiDocument } from "./document";

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

it("requires write headers and publishes only possible response statuses and headers", () => {
  for (const method of ["patch", "delete"]) {
    const op = document.paths["/feedstocks/{idOrCode}"][method];
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "If-Match", in: "header", required: true }));
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: false }));
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "dryRun", in: "query" }));
  }
  expect(document.paths["/feedstocks"].post.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: true }));
  expect(Object.keys(document.paths["/feedstocks/{idOrCode}"].delete.responses).sort()).toEqual(["200", "204", "400", "401", "403", "404", "409", "412", "422", "428", "429", "500", "503"]);
  expect(Object.keys(document.paths["/me"].get.responses).sort()).toEqual(["200", "401", "403", "404", "429", "500"]);
  expect(Object.keys(document.paths["/facilities"].get.responses).sort()).toEqual(["200", "400", "401", "403", "429", "500"]);
  const response = (path: string) => document.paths[path].get.responses["200"] as { headers: Record<string, unknown> };
  expect(response("/facilities/{idOrCode}").headers).toHaveProperty("ETag");
  expect(response("/drivers/{idOrCode}").headers).not.toHaveProperty("ETag");
  expect(response("/vehicles/{idOrCode}").headers).not.toHaveProperty("ETag");
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
