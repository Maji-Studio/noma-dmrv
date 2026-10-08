import { expect, it, vi } from "vitest";
import { serializeOpenApiDocument } from "@/lib/api/openapi/document";

// Fail if public discovery starts depending on the private harness or guards.
vi.mock("@/lib/auth/api-context", () => { throw new Error("Public discovery must not resolve credentials"); });
vi.mock("@/lib/api/guards", () => { throw new Error("Public discovery must not run rate-limit guards"); });
import { GET } from "./route";

it("serves the public generated document without a credential", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  expect(response.headers.has("www-authenticate")).toBe(false);
  expect(response.headers.has("ratelimit-limit")).toBe(false);
  expect(await response.text()).toBe(serializeOpenApiDocument());
});
