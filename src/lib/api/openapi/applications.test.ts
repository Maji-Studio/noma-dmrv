import { expect, it } from "vitest";
import { buildOpenApiDocument } from "./document";
import { BODY_HASH_ETAG_PATTERN } from "../etag";

it("publishes application reads, separate geometry and delivery balance alongside application writes", () => {
  const doc = buildOpenApiDocument();
  for (const [path, operationId, scope] of [
    ["/applications", "find_applications", "applications:read"],
    ["/applications/{idOrCode}", "get_application", "applications:read"],
    ["/applications/{idOrCode}/boundary", "get_application_boundary", "applications:read"],
    ["/deliveries/{idOrCode}/application-balance", "get_delivery_application_balance", "deliveries:read"],
  ]) {
    expect(doc.paths[path]).toHaveProperty("get");
    if (path.endsWith("/boundary") || path.endsWith("/application-balance")) expect(Object.keys(doc.paths[path])).toEqual(["get"]);
    const op = doc.paths[path].get;
    expect(op).toMatchObject({ operationId, "x-required-scope": scope });
    for (const status of [400, 401, 403, 404, 429, 500]) expect(op.responses).toHaveProperty(String(status));
    if (path.includes("{idOrCode}")) expect(op.responses["200"]).toMatchObject({ headers: { ETag: expect.any(Object) } });
  }
  for (const path of ["/applications/{idOrCode}", "/applications/{idOrCode}/boundary"]) {
    expect(doc.paths[path].get.responses).not.toHaveProperty("304");
    expect(doc.paths[path].get.parameters).not.toContainEqual(expect.objectContaining({ name: "If-None-Match" }));
  }
  expect(doc.paths["/deliveries/{idOrCode}/application-balance"].get.responses["200"]).toMatchObject({ headers: { ETag: { schema: { pattern: BODY_HASH_ETAG_PATTERN.source } } } });
  expect(doc.paths["/deliveries"].get.parameters).toContainEqual(expect.objectContaining({ name: "hasRemainingMass" }));
  expect(doc.components.schemas.application.properties).toMatchObject({ applicationDate: { format: "date" }, dryBiocharKg: { description: expect.stringContaining("Server-derived") } });
  expect(Object.keys(doc.components.schemas.application.properties!)).not.toContain("collection");
  const base = "/applications/{idOrCode}/documents";
  expect(doc.paths[base].get["x-required-scope"]).toBe("applications:read");
  expect(doc.paths[base].post["x-required-scope"]).toBe("applications:write");
  expect(doc.paths[`${base}/{documentId}/confirm`].post["x-required-scope"]).toBe("applications:write");
  expect(doc.components.schemas.document.properties).toMatchObject({ ownerType: { "x-extensible-enum": ["feedstock", "delivery", "lab_sample", "application"] } });
});

it("publishes the three application writes with raw geometry and write preconditions", () => {
  const doc = buildOpenApiDocument();
  for (const [path, method, id, scope] of [
    ["/applications", "post", "record_application", "applications:write"],
    ["/applications/{idOrCode}", "patch", "update_application", "applications:write"],
    ["/applications/{idOrCode}", "delete", "delete_application", "applications:delete"],
  ]) {
    const op = doc.paths[path][method];
    expect(op).toMatchObject({ operationId: id, "x-required-scope": scope });
    for (const status of [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503]) expect(op.responses).toHaveProperty(String(status));
    expect(op.responses).not.toHaveProperty("504");
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key" }));
    if (method !== "post") {
      expect(op.parameters).toContainEqual(expect.objectContaining({ name: "If-Match", required: true }));
      expect(op.responses).toHaveProperty("412"); expect(op.responses).toHaveProperty("428");
    }
  }
});
