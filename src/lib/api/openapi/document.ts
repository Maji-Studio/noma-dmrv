import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import { orderBalanceRepresentationSchema } from "@/lib/representations/order-balance";
import { createProductionRunInput, updateProductionRunInput } from "@/schemas/production-run-input";
import { productionRunRepresentationSchema } from "@/lib/representations/production-runs";
import { PRODUCTION_RUN_GUIDANCE } from "@/lib/operations/agent-guidance";
import { API_PRODUCTION_RUN_MAX_DRAWS } from "@/config/api-rest";
import { stockEffectsSchema } from "@/lib/representations/stock-effects";
import { API_VERSION } from "@/config/api-rest";
import { readDescriptions } from "@/lib/operations/read-descriptions";
import { z } from "zod";
import { API_BODY_MAX_BYTES, API_FEEDSTOCK_MAX_ALLOCATIONS, API_DOCS_CACHE_SECONDS } from "@/config/api-rest";
import { API_KEY_LIVE_PREFIX, API_KEY_TEST_PREFIX } from "@/config/api-keys";
import { createFeedstockSchema, updateFeedstockSchema } from "@/schemas/feedstocks";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { problemSchema } from "../problem-schema";
import { mutationQuerySchema } from "../query";
import { customerLocationListSchema, facilityLookupGetSchema, outputStockMovementListSchema, supplierLocationListSchema } from "../query-schemas";
import { outputStockMovementRepresentationSchema } from "@/lib/representations/output-stock-movements";
import { outputBinStockRepresentationSchema } from "@/lib/representations/output-bin-stock";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { meRepresentationSchema } from "@/lib/representations/me";
import { feedstockRepresentationSchema } from "@/lib/representations/feedstocks";
import { itemEnvelopeSchema, stockWriteEnvelopeSchema, listEnvelopeSchema, feedstockCreateEnvelopeSchema } from "@/lib/representations/envelopes";
import { resources } from "./resources";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { addBiocharWritePaths } from "./biochar-writes";
import { addOrderWritePaths } from "./order-writes";
import { addLabSampleWritePaths } from "./lab-sample-writes";
import { outputSchema, queryParameters, targetParameter, idempotencyParameter, ifMatchParameter, privateHeaders, requestIdHeader, etagHeader, stockEtagHeader, orderBalanceEtagHeader, writeHeaders, locationHeader, problemResponses, jsonResponse, headerComponents, problemResponseComponents } from "./transport";

const READ_ERRORS = [400, 401, 403, 429, 500];
const WRITE_ERRORS = [400, 401, 403, 404, 409, 422, 429, 500, 503];
const JSON_INDENT = 2;
const SNAPSHOT_LINE_WIDTH = 1000;

/** Pure deterministic build: no environment, clock, credential or database imports. */
export function buildOpenApiDocument() {
  const paths: Paths = {};
  const published = resources;
  const representations: Record<string, z.ZodType> = Object.fromEntries(published.map((resource) => [resource.singular, resource.schema]));
  representations.customer_location = customerLocationRepresentationSchema;
  representations.order_balance = orderBalanceRepresentationSchema;
  representations.supplier_location = supplierLocationRepresentationSchema;
  representations.output_stock_movement = outputStockMovementRepresentationSchema;
  representations.output_bin_stock = outputBinStockRepresentationSchema;
  representations.me = meRepresentationSchema;
  representations.stockEffects = stockEffectsSchema;
  const publishOutput = (schema: z.ZodType) => outputSchema(schema, representations);
  const schemas: Record<string, JsonSchema> = {
    ...Object.fromEntries(Object.entries(representations).map(([name, schema]) => [name, outputSchema(schema)])),
    Problem: publishOutput(problemSchema),
    FeedstockPreconditionProblem: {
      allOf: [
        { $ref: "#/components/schemas/Problem" },
        { type: "object", properties: { current: { $ref: "#/components/schemas/feedstock", description: "Current feedstock representation after a failed version precondition." } }, required: ["current"] },
      ],
    },
  };
  schemas.ProductionRunPreconditionProblem = {
    allOf: [{ $ref: "#/components/schemas/Problem" }, { type: "object", properties: {
      current: { $ref: "#/components/schemas/production_run", description: "Current production run after a failed version precondition." },
    }, required: ["current"] }],
  };
  const responses = problemResponseComponents();
  responses.FeedstockProblem412 = {
    ...responses.Problem412,
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/FeedstockPreconditionProblem" } } },
  };
  responses.ProductionRunProblem412 = { ...responses.Problem412,
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProductionRunPreconditionProblem" } } },
  };
  schemas.BiocharProductPreconditionProblem = {
    allOf: [{ $ref: "#/components/schemas/Problem" }, { type: "object", properties: {
      current: { $ref: "#/components/schemas/biochar_product", description: "Current biochar product after a failed version precondition." },
    }, required: ["current"] }],
  };
  responses.BiocharProductProblem412 = { ...responses.Problem412,
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/BiocharProductPreconditionProblem" } } },
  };
  schemas.LabSamplePreconditionProblem = {
    allOf: [{ $ref: "#/components/schemas/Problem" }, { type: "object", properties: {
      current: { $ref: "#/components/schemas/lab_sample", description: "Current lab sample after a failed version precondition." },
    }, required: ["current"] }],
  };
  responses.LabSampleProblem412 = { ...responses.Problem412,
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/LabSamplePreconditionProblem" } } },
  };
  schemas.OrderPreconditionProblem = {
    allOf: [{ $ref: "#/components/schemas/Problem" }, { type: "object", properties: {
      current: { $ref: "#/components/schemas/order", description: "Current order after a failed version precondition." },
    }, required: ["current"] }],
  };
  responses.OrderProblem412 = { ...responses.Problem412,
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/OrderPreconditionProblem" } } },
  };
  const runPreconditionResponse = { "412": { $ref: "#/components/responses/ProductionRunProblem412" } };
  const feedstockPreconditionResponse = { "412": { $ref: "#/components/responses/FeedstockProblem412" } };
  for (const resource of published) {
    paths[`/${resource.path}`] = { get: privateOperation(
      `find_${resource.path.replaceAll("-", "_")}`, resource.scope,
      resource.path === "orders" ? `${readDescriptions.list} ${readDescriptions.orders}` : resource.path === "customers" ? `${readDescriptions.list} ${readDescriptions.customers}` : readDescriptions.list,
      { ...problemResponses("facilityId" in resource.queries.list.shape ? [...READ_ERRORS, 404] : READ_ERRORS),
        "200": jsonResponse("Resource page.", publishOutput(listEnvelopeSchema(resource.schema))) },
      queryParameters(resource.queries.list),
    ) };
    paths[`/${resource.path}/{idOrCode}`] = { get: privateOperation(
      `get_${resource.singular}`, resource.scope, resource.path === "orders" ? readDescriptions.orders : resource.path === "customers" ? readDescriptions.customers : readDescriptions.get,
      { ...problemResponses([...READ_ERRORS, 404]), "200": jsonResponse("Resource representation.", publishOutput(itemEnvelopeSchema(resource.schema)), etagHeader) },
      [targetParameter(), ...queryParameters(resource.queries.get)],
    ) };
  }
  paths["/customers/{idOrCode}/locations"] = { get: privateOperation(
    "find_customer_locations", "customers:read", readDescriptions.customerLocations,
    { ...problemResponses([...READ_ERRORS, 404]), "200": jsonResponse("Customer location page.", publishOutput(listEnvelopeSchema(customerLocationRepresentationSchema))) },
    [targetParameter(), ...queryParameters(customerLocationListSchema)],
  ) };
  paths["/orders/{idOrCode}/balance"] = { get: privateOperation(
    "get_order_balance", "orders:read", readDescriptions.orderBalance,
    { ...problemResponses([...READ_ERRORS, 404]), "200": jsonResponse("Order balance snapshot.", publishOutput(itemEnvelopeSchema(orderBalanceRepresentationSchema)), orderBalanceEtagHeader) },
    [targetParameter()],
  ) };
  paths["/suppliers/{idOrCode}/locations"] = { get: privateOperation(
    "find_supplier_locations", "suppliers:read", readDescriptions.supplierLocations,
    { ...problemResponses([...READ_ERRORS, 404]), "200": jsonResponse("Supplier location page.", publishOutput(listEnvelopeSchema(supplierLocationRepresentationSchema))) },
    [targetParameter(true), ...queryParameters(supplierLocationListSchema)],
  ) };
  paths["/storage-locations/{idOrCode}/stock-movements"] = { get: privateOperation(
    "find_output_stock_movements", "biochar-products:read", readDescriptions.outputStockMovements,
    { ...problemResponses([...READ_ERRORS, 404, 422]), "200": jsonResponse("Movement page.", publishOutput(listEnvelopeSchema(outputStockMovementRepresentationSchema, "newest posting first"))) },
    [targetParameter(), ...queryParameters(outputStockMovementListSchema)],
  ) };
  paths["/storage-locations/{idOrCode}/stock"] = { get: privateOperation(
    "get_bin_stock", "biochar-products:read", readDescriptions.outputBinStock,
    { ...problemResponses([...READ_ERRORS, 404, 422]), "200": jsonResponse("Current output bin stock.", publishOutput(itemEnvelopeSchema(outputBinStockRepresentationSchema)), stockEtagHeader) },
    [targetParameter(), ...queryParameters(facilityLookupGetSchema)],
  ) };
  paths["/me"] = { get: privateOperation("whoami", undefined, readDescriptions.whoami,
    { ...problemResponses([401, 403, 404, 429, 500]), "200": jsonResponse("Credential context.", publishOutput(itemEnvelopeSchema(meRepresentationSchema))) }) };

  const createInput = operationInput(createFeedstockSchema);
  (createInput.properties as Record<string, JsonSchema>).allocations.maxItems = API_FEEDSTOCK_MAX_ALLOCATIONS;
  const patchInput = operationInput(updateFeedstockSchema.omit({ feedstockId: true, expectedVersion: true }));
  paths["/feedstocks"].post = {
    ...privateOperation("log_feedstock_delivery", "feedstocks:write", "Record a wood-chip intake split across receiving bins. Positive wet masses and moisture 0 to 100 are required; allocation overage requires justification. Dry runs roll back, skip external effects and return provisional ids, codes and stock additions. Location and ETag identify the first feedstock on committed responses and are absent on dry runs.",
      { ...problemResponses([...WRITE_ERRORS, 413, 415]),
        "201": jsonResponse("Intake committed, or replayed.", publishOutput(feedstockCreateEnvelopeSchema), { ...etagHeader, ...locationHeader, ...writeHeaders }),
        "200": jsonResponse("Dry-run intake preview.", publishOutput(feedstockCreateEnvelopeSchema), writeHeaders) },
      [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
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

  const runCreateInput = operationInput(createProductionRunInput);
  const drawSchema = (runCreateInput.properties as Record<string, JsonSchema>).feedstockDraws;
  drawSchema.maxItems = API_PRODUCTION_RUN_MAX_DRAWS;
  paths["/production-runs"].post = {
    ...privateOperation("start_production_run", "production-runs:write", `Start a production run and deduct explicit draws from feedstock bins. Dry runs roll back and return provisional data and stockEffects. Location and ETag appear only on committed creates. ${PRODUCTION_RUN_GUIDANCE}`,
      { ...problemResponses([...WRITE_ERRORS, 413, 415]),
        "201": jsonResponse("Production run committed, or replayed.", publishOutput(stockWriteEnvelopeSchema(productionRunRepresentationSchema)), { ...etagHeader, ...locationHeader, ...writeHeaders }),
        "200": jsonResponse("Dry-run production run preview.", publishOutput(stockWriteEnvelopeSchema(productionRunRepresentationSchema)), writeHeaders) },
      [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(runCreateInput, { facilityId: "df2795a4-886b-4a89-bbdd-532c6b1b8e45", reactorId: "ea31ace1-5b30-4443-adb4-26b43bfa5599", status: "running", startTime: { date: "2026-10-08", time: "09:30" } }),
  };
  const runPatchInput = operationInput(updateProductionRunInput.omit({ productionRunId: true, expectedVersion: true }));
  (runPatchInput.properties as Record<string, JsonSchema>).feedstockDraws.maxItems = API_PRODUCTION_RUN_MAX_DRAWS;
  paths["/production-runs/{idOrCode}"].patch = {
    ...privateOperation("update_production_run", "production-runs:write", `Update by UUID with a strong If-Match. Omission preserves fields, null clears clearable fields and zero stays zero. Status changes adjust stock through domain guards. Dry runs roll back; replays precede precondition checks. ${PRODUCTION_RUN_GUIDANCE}`,
      { ...problemResponses([...WRITE_ERRORS, 412, 413, 415, 428]), ...runPreconditionResponse,
        "200": jsonResponse("Updated production run or dry-run representation. ETag is absent on dry runs.", publishOutput(stockWriteEnvelopeSchema(productionRunRepresentationSchema)), { ...etagHeader, ...writeHeaders }) },
      [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: requestBody(runPatchInput, { status: "complete", endTime: "2026-10-08T11:00:00Z", biocharOutputKg: 500, biocharMoisturePercent: 2, biocharStorageLocationId: "f5ce7f12-464d-4a52-a3c3-fba01dbe9b8e" }),
  };
  paths["/production-runs/{idOrCode}"].delete = {
    ...privateOperation("delete_production_run", "production-runs:delete", "Delete by UUID using a strong If-Match and return drawn stock. Dependencies may refuse deletion. Dry runs roll back and return the deleted representation and stockEffects. A supplied body must be an empty JSON object.",
      { ...problemResponses([...WRITE_ERRORS, 412, 413, 415, 428]), ...runPreconditionResponse,
        "204": { description: "Deleted or replayed deletion; no body.", headers: { ...privateHeaders, ...writeHeaders } },
        "200": jsonResponse("Dry-run deleted representation.", publishOutput(stockWriteEnvelopeSchema(productionRunRepresentationSchema)), writeHeaders) },
      [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: { required: false, description: `Optional empty JSON object, maximum ${API_BODY_MAX_BYTES} bytes.`, content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } } },
  };

  addBiocharWritePaths(paths, { publishOutput, writeErrors: WRITE_ERRORS });
  addLabSampleWritePaths(paths, { publishOutput, writeErrors: WRITE_ERRORS });
  addOrderWritePaths(paths, { publishOutput, writeErrors: WRITE_ERRORS });

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
    info: { title: "noma data-entry API", version: API_VERSION, description: "Organization-scoped feedstock intake, production runs, biochar products, lab samples, orders and balances, and read-only customer and destination lookups, including formulations and output bin stock movement history. Business dates are facility-local YYYY-MM-DD; event times are sent as RFC 3339 with an explicit offset or as facility-local { date, time }, and returned as UTC instants. Additive changes remain in v1; breaking versions use v2 with Deprecation and Sunset headers. Unsupported methods on visible paths return Problem405 with Allow listing supported methods, including automatic HEAD and OPTIONS. Private refusals follow bearer authentication and path visibility checks; unknown or invisible paths return 404 without Allow. Public discovery paths need no credential. This response is a path-level refusal, not a response of a published operation." },
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
