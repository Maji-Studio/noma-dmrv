import { expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  API_LIST_DEFAULT_LIMIT: 2,
  API_LIST_MAX_LIMIT: 5,
  API_IDEMPOTENCY_KEY_MAX_LENGTH: 17,
  API_BODY_MAX_BYTES: 1024,
  API_KEY_LIVE_PREFIX: "custom_live_",
  API_KEY_TEST_PREFIX: "custom_test_",
  IDEMPOTENCY_RETENTION_DAYS: 3,
}));
vi.mock("@/config/api-rest", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/config/api-rest")>(),
  API_LIST_DEFAULT_LIMIT: config.API_LIST_DEFAULT_LIMIT,
  API_LIST_MAX_LIMIT: config.API_LIST_MAX_LIMIT,
  API_IDEMPOTENCY_KEY_MAX_LENGTH: config.API_IDEMPOTENCY_KEY_MAX_LENGTH,
  API_BODY_MAX_BYTES: config.API_BODY_MAX_BYTES,
}));
vi.mock("@/config/api-keys", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/config/api-keys")>(),
  API_KEY_LIVE_PREFIX: config.API_KEY_LIVE_PREFIX,
  API_KEY_TEST_PREFIX: config.API_KEY_TEST_PREFIX,
}));
vi.mock("../query-schemas", async (importOriginal) => {
  const original = await importOriginal<typeof import("../query-schemas")>();
  return {
    ...original,
    resourceQueries: {
      ...original.resourceQueries,
      vehicles: { list: original.facilityLookupListSchema, get: original.lookupGetSchema },
      "storage-locations": { list: original.lookupListSchema, get: original.facilityLookupGetSchema },
    },
  };
});
vi.mock("@/config/operations", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/config/operations")>(),
  IDEMPOTENCY_RETENTION_DAYS: config.IDEMPOTENCY_RETENTION_DAYS,
}));

import { llmsGuide } from "../llms-guide";
import { readIdempotencyKey } from "../request-body";
import { buildOpenApiDocument } from "./document";

it("updates the guide, published parameters and parser guidance when configuration changes", () => {
  const { API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, API_IDEMPOTENCY_KEY_MAX_LENGTH, IDEMPOTENCY_RETENTION_DAYS } = config;
  expect(llmsGuide).toContain(`default ${API_LIST_DEFAULT_LIMIT} and maximum ${API_LIST_MAX_LIMIT}`);
  expect(llmsGuide).toContain(`1 to ${API_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters`);
  expect(llmsGuide).toContain(`retained for ${IDEMPOTENCY_RETENTION_DAYS} days`);
  const parameters = buildOpenApiDocument().paths["/feedstocks"].post.parameters;
  expect(parameters).toContainEqual(expect.objectContaining({
    name: "Idempotency-Key",
    description: expect.stringContaining(`1 to ${API_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters`),
    schema: expect.objectContaining({ maxLength: API_IDEMPOTENCY_KEY_MAX_LENGTH }),
  }));
  expect(parameters).toContainEqual(expect.objectContaining({
    name: "Idempotency-Key", description: expect.stringContaining(`retained for ${IDEMPOTENCY_RETENTION_DAYS} days`),
  }));
  expect(buildOpenApiDocument().paths["/feedstocks"].get.parameters).toContainEqual(expect.objectContaining({
    name: "limit", schema: expect.objectContaining({ default: API_LIST_DEFAULT_LIMIT, maximum: API_LIST_MAX_LIMIT }),
  }));
  const keyed = (length: number) => new Request("https://example.test", { headers: { "Idempotency-Key": "x".repeat(length) } });
  expect(readIdempotencyKey(keyed(API_IDEMPOTENCY_KEY_MAX_LENGTH), true)).toHaveLength(API_IDEMPOTENCY_KEY_MAX_LENGTH);
  expect(() => readIdempotencyKey(keyed(API_IDEMPOTENCY_KEY_MAX_LENGTH + 1), true))
    .toThrow(`Use 1 to ${API_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters for Idempotency-Key.`);
});

it("takes body limits and credential prefixes from shared configuration", () => {
  const document = buildOpenApiDocument();
  expect(document.paths["/feedstocks/{idOrCode}"].delete.requestBody).toMatchObject({
    description: expect.stringContaining(`maximum ${config.API_BODY_MAX_BYTES} bytes`),
  });
  for (const prefix of [config.API_KEY_LIVE_PREFIX, config.API_KEY_TEST_PREFIX]) {
    expect(document.components.securitySchemes.bearerAuth.description).toContain(prefix);
    expect(llmsGuide).toContain(prefix);
  }
});

it("follows resource query schemas for parameters and facility-filter 404s", () => {
  const document = buildOpenApiDocument();
  const vehicles = document.paths["/vehicles"].get;
  expect(vehicles.parameters).toContainEqual(expect.objectContaining({ name: "facilityId", in: "query" }));
  expect(vehicles.responses).toHaveProperty("404");
  const storageLocations = document.paths["/storage-locations"].get;
  expect(storageLocations.parameters).not.toContainEqual(expect.objectContaining({ name: "facilityId" }));
  expect(storageLocations.responses).not.toHaveProperty("404");
});
