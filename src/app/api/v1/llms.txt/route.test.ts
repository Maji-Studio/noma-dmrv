import { expect, it, vi } from "vitest";

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
  const text = await response.text();
  for (const term of ["/api/v1/openapi.json", "Authorization: Bearer", "feedstocks:write", "Idempotency-Key", "ETag", "If-Match", "dryRun", "nextCursor", "problem+json", "outcome_unknown", "Retry-After", "today", "timeZone"]) expect(text).toContain(term);
  expect(text).not.toMatch(/[\u2013\u2014]/);
});
