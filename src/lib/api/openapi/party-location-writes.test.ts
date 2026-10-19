import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./document";

const document = buildOpenApiDocument();
describe.each(["supplier", "customer"] as const)("%s location OpenAPI writes", kind => {
  const collection = `/${kind}s/{idOrCode}/locations`;
  const detail = `${collection}/{locationId}`;
  it("publishes UUID-only adds with mandatory keys and distinct dry-run headers", () => {
    const create = document.paths[collection].post;
    expect(create).toMatchObject({ operationId: `add_${kind}_location`, "x-required-scope": `${kind}s:write` });
    expect(create.parameters).toContainEqual(expect.objectContaining({ name: "idOrCode", schema: { type: "string", format: "uuid" } }));
    expect(create.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: true }));
    expect(create.responses["201"]).toMatchObject({ headers: { ETag: expect.any(Object), Location: expect.any(Object) } });
    expect(create.responses["200"]).toMatchObject({ headers: { "Dry-Run": expect.any(Object) } });
    expect(create.responses["200"]).not.toHaveProperty("headers.ETag");
    expect(create.responses["200"]).not.toHaveProperty("headers.Location");
    expect(create.requestBody).toMatchObject({ content: { "application/json": { schema: { additionalProperties: false } } } });
  });
  it("documents child preconditions, warnings and typed stale representations for each command", () => {
    const commands = kind === "supplier" ? ["update", "delete"] : ["update", "delete", "archive", "restore"];
    for (const command of commands) {
      const path = command === "archive" || command === "restore" ? `${detail}/${command}` : detail;
      const method = command === "update" ? "patch" : command === "delete" ? "delete" : "post";
      const write = document.paths[path][method];
      expect(write).toMatchObject({ operationId: `${command}_${kind}_location`, "x-required-scope": `${kind}s:${command === "delete" ? "delete" : "write"}` });
      expect(write.parameters).toContainEqual(expect.objectContaining({ name: "locationId", required: true, schema: { type: "string", format: "uuid" } }));
      expect(write.parameters).toContainEqual(expect.objectContaining({ name: "If-Match", required: true }));
      expect(write.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: false }));
      expect(write.responses).toHaveProperty("428");
      expect(write.responses["412"]).toEqual({ $ref: `#/components/responses/${kind === "supplier" ? "Supplier" : "Customer"}LocationProblem412` });
      expect(write.responses["200"]).toMatchObject({ content: { "application/json": { schema: { properties: { data: { $ref: `#/components/schemas/${kind}_location` }, warnings: { type: "array" } } } } } });
      if (command === "delete") expect(write.responses["204"]).not.toHaveProperty("content");
    }
  });
});

it("documents the optional customer delete fingerprint, cascade and fresh conflict preview", () => {
  const deletion = document.paths["/customers/{idOrCode}"].delete;
  expect(deletion.parameters).toContainEqual(expect.objectContaining({ name: "cascadeFingerprint", in: "query", required: false }));
  expect(deletion.description).toContain("cascade_changed");
  expect(deletion.responses["200"]).toMatchObject({ content: { "application/json": { schema: { required: ["data", "cascade"], properties: { cascade: { required: ["orders", "cascadeFingerprint"] } } } } } });
  expect(deletion.responses["409"]).toMatchObject({ content: { "application/problem+json": { schema: {
    properties: { preview: { required: ["orders", "cascadeFingerprint"] } },
  } } } });
  expect(document.components.schemas.Problem.properties).toHaveProperty("preview.properties.basisFingerprint");
});
