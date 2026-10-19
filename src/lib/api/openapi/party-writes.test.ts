import { describe, expect, it } from "vitest";
import { createSupplierApiInput, updateSupplierApiInput } from "@/schemas/supplier-input";
import { createCustomerApiInput, updateCustomerApiInput } from "@/schemas/customer-input";
import { llmsGuide } from "../llms-guide";
import { LOCATION_DISTANCE_MIN_KM, LOCATION_DISTANCE_MAX_KM, PARTY_MAX_LOCATIONS } from "@/config/party-input";
import { operationInput } from "./operation-kit";
import { buildOpenApiDocument } from "./document";

const document = buildOpenApiDocument();

describe.each([
  ["supplier", createSupplierApiInput, updateSupplierApiInput],
  ["customer", createCustomerApiInput, updateCustomerApiInput],
] as const)("%s OpenAPI writes", (kind, createInput, updateInput) => {
  it("introduces writes and scopes in both agent guides", () => {
    for (const text of [document.info.description, llmsGuide]) {
      expect(text).toContain(`POST /${kind}s with Idempotency-Key`);
      expect(text).toContain(`PATCH and DELETE /${kind}s/{id}`);
      expect(text).toContain(`POST /${kind}s/{id}/archive and /restore`);
      expect(text).toContain(`${kind}s:write for create, update, archive and restore`);
      expect(text).toContain(`${kind}s:delete for delete`);
    }
  });
  it("publishes update and command preconditions, typed current and exact scopes", () => {
    const cap = kind === "supplier" ? "Supplier" : "Customer";
    expect(document.components.schemas[`${cap}PreconditionProblem`]).toMatchObject({ allOf: [
      { $ref: "#/components/schemas/Problem" }, { required: ["current"], properties: { current: { $ref: `#/components/schemas/${kind}` } } },
    ] });
    for (const [method, suffix, operation, scope] of [
      ["patch", "", "update", "write"], ["delete", "", "delete", "delete"],
      ["post", "/archive", "archive", "write"], ["post", "/restore", "restore", "write"],
    ]) {
      const write = document.paths[`/${kind}s/{idOrCode}${suffix}`][method];
      expect(write).toMatchObject({ operationId: `${operation}_${kind}`, "x-required-scope": `${kind}s:${scope}` });
      expect(write.parameters).toContainEqual(expect.objectContaining({ name: "If-Match", required: true }));
      expect(write.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: false }));
      expect(write.responses).toHaveProperty("428");
      expect(write.responses["412"]).toEqual({ $ref: `#/components/responses/${cap}Problem412` });
      if (method === "patch") expect(write.requestBody).toMatchObject({ content: { "application/json": { schema: operationInput(updateInput) } } });
      else expect(write.requestBody).toMatchObject({ required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false } } } });
    }
  });
  it("keeps location creation guidance off PATCH while documenting name and code conflicts", () => {
    const create = document.paths[`/${kind}s`].post.description;
    const patch = document.paths[`/${kind}s/{idOrCode}`].patch.description;
    expect(create).toContain("Create requires 1 to");
    expect(create).toContain("Facility distances are one-way km");
    expect(patch).toContain("Duplicate names answer 409 conflict at /name");
    expect(patch).toContain("archived: true");
    expect(patch).toContain("Duplicate codes answer 409 conflict at /code");
    expect(patch).not.toContain("Create requires");
    expect(patch).not.toContain("Facility distances");
    expect(patch).not.toContain("/locations/{index}");
  });
  it("publishes strict nested fields, numeric bounds and no contacts", () => {
    const schema = operationInput(createInput);
    expect(schema).toMatchObject({ additionalProperties: false, properties: { locations: { minItems: 1, maxItems: PARTY_MAX_LOCATIONS,
      items: { additionalProperties: false, properties: { facilityDistances: { items: { additionalProperties: false,
        properties: { distanceKm: { anyOf: [{ type: "number", minimum: LOCATION_DISTANCE_MIN_KM, maximum: LOCATION_DISTANCE_MAX_KM }, { type: "null" }] } },
      } } } } } } });
    for (const key of ["code", "contactName", "contactEmail", "contactPhone", "address", "location"]) expect(schema.properties).not.toHaveProperty(key);
  });
  it("publishes the restricted strict create contract and location envelope", () => {
    const create = document.paths[`/${kind}s`].post;
    expect(create).toBeDefined();
    expect(create.requestBody).toMatchObject({ content: { "application/json": { schema: operationInput(createInput) } } });
    expect(create.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: true }));
    expect(create.responses["201"]).toMatchObject({ headers: { ETag: expect.any(Object), Location: expect.any(Object) },
      content: { "application/json": { schema: { required: ["data", "locations"] } } } });
    expect(create.responses["200"]).not.toHaveProperty("headers.ETag");
  });
});
