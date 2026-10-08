/** Real plugin/HTTP dispatch against an in-memory adapter; never connects to PostgreSQL. */
import { beforeEach, expect, it, vi } from "vitest";
import { API_KEY_DEFAULT_EXPIRY_SECONDS, MILLISECONDS_PER_SECOND } from "@/config/api-keys";
const memory = vi.hoisted(() => ({
  user: [] as Record<string, unknown>[],
  organization: [] as Record<string, unknown>[],
  member: [] as Record<string, unknown>[],
  apikey: [] as Record<string, unknown>[],
  session: [] as Record<string, unknown>[],
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/org-defaults", () => ({ seedOrgDefaults: vi.fn() }));
vi.mock("@/data-access/api-credential-auth", () => ({ disableOwnerApiKeys: vi.fn() }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter(memory) };
});
import { auth } from "./better-auth";

beforeEach(() => {
  memory.user.length = 0;
  memory.organization.length = 0;
  memory.member.length = 0;
  memory.apikey.length = 0;
  memory.user.push({ id: "owner", email: "synthetic@example.test", emailVerified: true, name: "Test" });
  memory.organization.push({ id: "org", name: "Test org", slug: "test-org", createdAt: new Date() });
  memory.member.push({ id: "membership", userId: "owner", organizationId: "org", role: "admin", createdAt: new Date() });
});
it.each(["create", "update", "delete"])("blocks HTTP /api-key/%s before plugin logic", async (action) => {
  const response = await auth.handler(new Request(`http://localhost:3100/api/auth/api-key/${action}`, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3100" },
    body: JSON.stringify({ name: "Unsafe", organizationId: "org", keyId: "id", expiresIn: null }),
  }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ message: "Use organization credential actions." });
  expect(memory.apikey).toHaveLength(0);
});
it("allows trusted server issuance by Admin with a 90-day default, no rate limit or session emulation", async () => {
  const started = Date.now();
  const created = await auth.api.createApiKey({ body: { userId: "owner", organizationId: "org", name: "Intake", permissions: { feedstocks: ["read"] } } });
  expect(created.key).toMatch(/^noma_test_/);
  expect(created.referenceId).toBe("org");
  expect(created.rateLimitEnabled).toBe(false);
  expect(created.start).toBeNull();
  expect(created.expiresAt!.getTime() - started).toBeGreaterThanOrEqual(API_KEY_DEFAULT_EXPIRY_SECONDS * MILLISECONDS_PER_SECOND);
  expect(created.expiresAt!.getTime() - started).toBeLessThan((API_KEY_DEFAULT_EXPIRY_SECONDS + 5) * MILLISECONDS_PER_SECOND);
  expect(memory.apikey[0].key).not.toBe(created.key);
  const verified = await auth.api.verifyApiKey({ body: { key: created.key } });
  expect(verified.valid).toBe(true);
  expect(await auth.api.getSession({ headers: new Headers({ "x-api-key": created.key }) })).toBeNull();
});
it("allows header-free server updates but blocks header-bearing calls", async () => {
  const created = await auth.api.createApiKey({ body: { userId: "owner", organizationId: "org", name: "Intake" } });
  const updated = await auth.api.updateApiKey({ body: { userId: "owner", keyId: created.id, name: "Renamed", permissions: {} } });
  expect(updated.name).toBe("Renamed");
  expect(updated).not.toHaveProperty("key");
  await expect(auth.api.updateApiKey({ headers: new Headers(), body: { userId: "owner", keyId: created.id, expiresIn: null } })).rejects.toMatchObject({ status: "FORBIDDEN" });
});
