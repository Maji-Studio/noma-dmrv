import { stockEffectsSchema } from "@/lib/representations/stock-effects";
import { API_VERSION } from "@/config/api-rest";
import { readDescriptions } from "@/lib/operations/read-descriptions";
import { z } from "zod";
import { API_BODY_MAX_BYTES, API_FEEDSTOCK_MAX_ALLOCATIONS, API_DOCS_CACHE_SECONDS } from "@/config/api-rest";
import { API_KEY_LIVE_PREFIX, API_KEY_TEST_PREFIX } from "@/config/api-keys";
import { createFeedstockSchema, updateFeedstockSchema } from "@/schemas/feedstocks";
import { toOperationJsonSchema, type JsonSchema } from "@/lib/operations/json-schema";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { problemSchema } from "../problem-schema";
import { mutationQuerySchema } from "../query";
import { supplierLocationListSchema } from "../query-schemas";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { meRepresentationSchema } from "@/lib/representations/me";
import { feedstockRepresentationSchema } from "@/lib/representations/feedstocks";
import { itemEnvelopeSchema, stockWriteEnvelopeSchema, listEnvelopeSchema, feedstockCreateEnvelopeSchema } from "@/lib/representations/envelopes";
import { resources } from "./resources";
import { outputSchema, queryParameters, targetParameter, idempotencyParameter, ifMatchParameter, privateHeaders, requestIdHeader, etagHeader, writeHeaders, locationHeader, problemResponses, jsonResponse, headerComponents, problemResponseComponents } from "./transport";

interface OperationDocument {
  operationId: string;
  description: string;
  "x-required-scope": ApiScope | null;
  security?: { bearerAuth: never[] }[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}
type Paths = Record<string, Record<string, OperationDocument>>;
const READ_ERRORS = [400, 401, 403, 429, 500];
const WRITE_ERRORS = [400, 401, 403, 404, 409, 422, 429, 500, 503];
const JSON_INDENT = 2;
const SNAPSHOT_LINE_WIDTH = 500;

function privateOperation(operationId: string, scope: ApiScope | undefined, description: string, responses: Record<string, unknown>, parameters: unknown[] = []): OperationDocument {
  return { operationId, description: `${description} Required scope: ${scope ?? "none (any authenticated API key)"}.`, "x-required-scope": scope ?? null, parameters, responses };
}
function operationInput(schema: Parameters<typeof toOperationJsonSchema>[0]): JsonSchema {
  const result = toOperationJsonSchema(schema);
  delete result.$schema;
  // REST rejects unknown keys recursively, while forms retain their stripping behavior.
  function close(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(close);
    const record = node as JsonSchema;
    if (record.properties) record.additionalProperties = false;
    Object.values(record).forEach(close);
  }
  close(result);
  return result;
}

/** Pure deterministic build: no environment, clock, credential or database imports. */
export function buildOpenApiDocument() {
  const paths: Paths = {};
  const representations: Record<string, z.ZodType> = Object.fromEntries(resources.map((resource) => [resource.singular, resource.schema]));
  representations.supplier_location = supplierLocationRepresentationSchema;
  representations.me = meRepresentationSchema;
  representations.stockEffects = stockEffectsSchema;
  const publishOutput = (schema: z.ZodType) => outputSchema(schema, representations);
  const schemas: Record<string, JsonSchema> = {
    ...Object.fromEntries(Object.entries(representations).map(([name, schema]) => [name, outputSchema(schema)])),
    Problem: outputSchema(problemSchema),
    FeedstockPreconditionProblem: {
      allOf: [
        { $ref: "#/components/schemas/Problem" },
        { type: "object", properties: { current: { $ref: "#/components/schemas/feedstock", description: "Current feedstock representation after a failed version precondition." } }, required: ["current"] },
      ],
    },
  };
  const responses = problemResponseComponents();
  responses.FeedstockProblem412 = {
    ...responses.Problem412,
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/FeedstockPreconditionProblem" } } },
  };
  const feedstockPreconditionResponse = { "412": { $ref: "#/components/responses/FeedstockProblem412" } };
  for (const resource of resources) {
    paths[`/${resource.path}`] = { get: privateOperation(
      `find_${resource.path.replaceAll("-", "_")}`, resource.scope,
      readDescriptions.list,
      { ...problemResponses("facilityId" in resource.queries.list.shape ? [...READ_ERRORS, 404] : READ_ERRORS),
        "200": jsonResponse("Resource page.", publishOutput(listEnvelopeSchema(resource.schema))) },
      queryParameters(resource.queries.list),
    ) };
    paths[`/${resource.path}/{idOrCode}`] = { get: privateOperation(
      `get_${resource.singular}`, resource.scope, readDescriptions.get,
      { ...problemResponses([...READ_ERRORS, 404]), "200": jsonResponse("Resource representation.", publishOutput(itemEnvelopeSchema(resource.schema)), etagHeader) },
      [targetParameter(), ...queryParameters(resource.queries.get)],
    ) };
  }
  paths["/suppliers/{idOrCode}/locations"] = { get: privateOperation(
    "find_supplier_locations", "suppliers:read", readDescriptions.supplierLocations,
    { ...problemResponses([...READ_ERRORS, 404]), "200": jsonResponse("Supplier location page.", publishOutput(listEnvelopeSchema(supplierLocationRepresentationSchema))) },
    [targetParameter(true), ...queryParameters(supplierLocationListSchema)],
  ) };
  paths["/me"] = { get: privateOperation("whoami", undefined, readDescriptions.whoami,
    { ...problemResponses([401, 403, 404, 429, 500]), "200": jsonResponse("Credential context.", publishOutput(itemEnvelopeSchema(meRepresentationSchema))) }) };

  const createInput = operationInput(createFeedstockSchema);
  (createInput.properties as Record<string, JsonSchema>).allocations.maxItems = API_FEEDSTOCK_MAX_ALLOCATIONS;
  const patchInput = operationInput(updateFeedstockSchema.omit({ feedstockId: true, expectedVersion: true }));
  const requestBody = (schema: JsonSchema, example: unknown) => ({ required: true, description: `JSON body, maximum ${API_BODY_MAX_BYTES} bytes. Unknown properties are rejected.`, content: { "application/json": { schema, example } } });
  paths["/feedstocks"].post = {
    ...privateOperation("log_feedstock_delivery", "feedstocks:write", "Record a wood-chip intake split across receiving bins. Positive wet masses and moisture 0 to 100 are required; allocation overage requires justification. Dry runs roll back, skip external effects and return provisional ids, codes and stock additions. Location and ETag identify the first feedstock on committed responses and are absent on dry runs.",
      { ...problemResponses([...WRITE_ERRORS, 413, 415]),
        "201": jsonResponse("Intake committed, or replayed.", publishOutput(feedstockCreateEnvelopeSchema), { ...etagHeader, ...locationHeader, ...writeHeaders }),
        "200": jsonResponse("Dry-run intake preview.", publishOutput(feedstockCreateEnvelopeSchema), writeHeaders) },
      [...queryParameters(mutationQuerySchema), idempotencyParameter(false)]),
    requestBody: requestBody(createInput, {
      facilityId: "df2795a4-886b-4a89-bbdd-532c6b1b8e45", deliveryDate: "2026-10-08",
      supplierId: "ea31ace1-5b30-4443-adb4-26b43bfa5599", feedstockTypeId: "b54b7b81-9b54-4757-ae1b-99fb28ea1c7f",
      totalWetMassKg: 4200, moisturePercent: 32.5,
      allocations: [{ storageLocationId: "df0f2a35-884c-4293-8783-31aa9fc5e315", allocatedWetMassKg: 4200 }],
      notes: "Wood chips from the supplier sawmill, unloaded into bin B2.",
    }),
  };
  paths["/feedstocks/{idOrCode}"].patch = {
    ...privateOperation("update_feedstock", "feedstocks:write", "Update by UUID using a strong If-Match. Omitted fields stay unchanged, null clears clearable fields, zero stays zero. Wet/dry mass and moisture are validated against locked merged state. Dry runs roll back. Replays precede version rechecking.",
      { ...problemResponses([...WRITE_ERRORS, 412, 413, 415, 428]), ...feedstockPreconditionResponse, "200": jsonResponse("Updated feedstock or dry-run representation. ETag is absent on dry runs.", publishOutput(stockWriteEnvelopeSchema(feedstockRepresentationSchema)), { ...etagHeader, ...writeHeaders }) },
      [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: requestBody(patchInput, { massWetKg: 4250, notes: "Corrected weighbridge wet mass for bin B2." }),
  };
  paths["/feedstocks/{idOrCode}"].delete = {
    ...privateOperation("delete_feedstock", "feedstocks:delete", "Delete by UUID using a strong If-Match. Locked domain guards may refuse deletion. Dry runs return the would-be deleted representation and roll back. The request body may be omitted; any supplied body must be an empty JSON object. Malformed JSON returns 400; unknown fields and other JSON values return 422.",
    { ...problemResponses([...WRITE_ERRORS, 412, 413, 415, 428]), ...feedstockPreconditionResponse,
      "204": { description: "Deleted, or replay of a committed deletion; no body.", headers: { ...privateHeaders, ...writeHeaders } },
      "200": jsonResponse("Dry-run deleted representation.", publishOutput(stockWriteEnvelopeSchema(feedstockRepresentationSchema)), writeHeaders) },
    [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: {
      required: false,
      description: `Optional; when sent it must be an empty JSON object, maximum ${API_BODY_MAX_BYTES} bytes.`,
      content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } },
    },
  };

  for (const [path, operationId, mediaType, description] of [
    ["/openapi.json", "get_openapi_document", "application/json", "Public OpenAPI 3.1 contract."],
    ["/llms.txt", "get_llms_guide", "text/plain", "Public agent guide."],
  ]) {
    paths[path] = { get: { operationId, description, "x-required-scope": null, security: [], responses: { "200": {
      description,
      headers: { ...requestIdHeader, "Cache-Control": { description: `Public cache, max-age=${API_DOCS_CACHE_SECONDS} seconds.`, schema: { type: "string" } } },
      content: { [mediaType]: { schema: mediaType === "text/plain" ? { type: "string", description: "Plain-text guide for API agents." } : { type: "object", description: "OpenAPI 3.1 document.", additionalProperties: true } } },
    } } } };
  }
  return {
    openapi: "3.1.0",
    info: { title: "noma data-entry API", version: API_VERSION, description: "Organization-scoped feedstock intake and read-only lookups. Business dates are facility-local YYYY-MM-DD; event instants use RFC 3339 UTC. Additive changes remain in v1; breaking versions use v2 with Deprecation and Sunset headers." },
    servers: [{ url: "/api/v1" }], security: [{ bearerAuth: [] }], paths,
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API key", description: `Authorization: Bearer <key> only. Keys use ${API_KEY_LIVE_PREFIX} or ${API_KEY_TEST_PREFIX} prefixes and bind exactly one organization; cookies and x-api-key cannot authorize requests.` } }, schemas, headers: headerComponents, responses },
  };
}

/** Sort every object key, preserving semantic array ordering. */
function stableKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stableKeys(child)]),
  );
  return value;
}
/** Compact leaf schemas keep field changes on one diff line and the snapshot below the file cap. */
function compactJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactJson).join(", ")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).map(([key, child]) =>
    `${JSON.stringify(key)}: ${compactJson(child)}`).join(", ")}}`;
  return JSON.stringify(value);
}
function prettyJson(value: unknown, level = 0): string {
  const compact = compactJson(value);
  if (compact.length + level * JSON_INDENT <= SNAPSHOT_LINE_WIDTH) return compact;
  const indent = " ".repeat(level * JSON_INDENT);
  const childIndent = " ".repeat((level + 1) * JSON_INDENT);
  if (Array.isArray(value)) return `[\n${value.map((child) => childIndent + prettyJson(child, level + 1)).join(",\n")}\n${indent}]`;
  if (value !== null && typeof value === "object") return `{\n${Object.entries(value).map(([key, child]) =>
    `${childIndent}${JSON.stringify(key)}: ${prettyJson(child, level + 1)}`).join(",\n")}\n${indent}}`;
  return compact;
}
export function serializeOpenApiDocument(): string {
  return `${prettyJson(stableKeys(buildOpenApiDocument()))}\n`;
}

let serializedDocument: string | undefined;

/** Reuse the public contract across requests within this module instance. */
export function getSerializedOpenApiDocument(): string {
  return serializedDocument ??= serializeOpenApiDocument();
}
