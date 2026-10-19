import { expect, it, vi } from "vitest";
import { z } from "zod";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { serializeOpenApiDocument } from "@/lib/api/openapi/document";

// Fail if public discovery starts depending on the private harness or guards.
vi.mock("@/lib/auth/api-context", () => { throw new Error("Public discovery must not resolve credentials"); });
vi.mock("@/lib/api/guards", () => { throw new Error("Public discovery must not run rate-limit guards"); });
vi.mock("@/lib/operations/json-schema", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/operations/json-schema")>();
  return { ...original, toOperationJsonSchema: vi.fn(original.toOperationJsonSchema) };
});
import { GET } from "./route";

it("serves the public generated document without a credential", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  expect(response.headers.has("www-authenticate")).toBe(false);
  expect(response.headers.has("ratelimit-limit")).toBe(false);
  const schemaBuilds = vi.mocked(toOperationJsonSchema).mock.calls.length;
  expect(schemaBuilds).toBeGreaterThan(0);
  const repeated = GET();
  expect(vi.mocked(toOperationJsonSchema).mock.calls).toHaveLength(schemaBuilds);
  expect(z.uuid().safeParse(response.headers.get("x-request-id")).success).toBe(true);
  expect(z.uuid().safeParse(repeated.headers.get("x-request-id")).success).toBe(true);
  expect(repeated.headers.get("x-request-id")).not.toBe(response.headers.get("x-request-id"));
  expect(await repeated.text()).toBe(serializeOpenApiDocument());
  expect(await response.text()).toBe(serializeOpenApiDocument());
});
