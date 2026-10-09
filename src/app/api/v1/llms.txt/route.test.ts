import { expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/auth/api-context", () => { throw new Error("Public discovery must not resolve credentials"); });
vi.mock("@/lib/api/guards", () => { throw new Error("Public discovery must not run rate-limit guards"); });
import { GET } from "./route";

it("serves a public plain-text agent guide without a credential", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  expect(response.headers.has("www-authenticate")).toBe(false);
  expect(response.headers.has("ratelimit-limit")).toBe(false);
  const repeated = GET();
  expect(z.uuid().safeParse(response.headers.get("x-request-id")).success).toBe(true);
  expect(z.uuid().safeParse(repeated.headers.get("x-request-id")).success).toBe(true);
  expect(repeated.headers.get("x-request-id")).not.toBe(response.headers.get("x-request-id"));
  const text = await response.text();
  expect(await repeated.text()).toBe(text);
  expect(text).toContain("X-Request-Id identifies requests.");
  expect(text).toContain("Required on every POST create, including dry runs");
  expect(text).toContain("POST dry runs require a key.");
  expect(text).toContain("Dry runs do not consume or replay keys; an already committed key returns 409.");
  for (const term of ["/api/v1/openapi.json", "Authorization: Bearer", "feedstocks:write", "Idempotency-Key", "ETag", "If-Match", "dryRun", "nextCursor", "problem+json", "outcome_unknown", "Retry-After", "today", "timeZone"]) expect(text).toContain(term);
  expect(text).not.toMatch(/[\u2013\u2014]/);
});
