import { beforeEach, expect, it, vi } from "vitest";
import { oauthBefore } from "./oauth-hooks";
import { OAUTH_REQUESTABLE_SCOPES } from "./oauth-scopes";

const mocks = vi.hoisted(() => ({ scopes: vi.fn() }));
vi.mock("better-auth/api", async importOriginal => ({ ...await importOriginal<typeof import("better-auth/api")>(),
  getSessionFromCtx: vi.fn().mockResolvedValue(null) }));
vi.mock("@/config/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://noma.test", OAUTH_CIMD_CLIENT_IDS: ["https://listed.test/metadata"] } }));
vi.mock("@/data-access/oauth-provider", () => ({ findOAuthClientScopes: mocks.scopes,
  findOAuthClientResources: vi.fn(), findOAuthOfflineGenerations: vi.fn() }));
vi.mock("@/data-access/oauth-token-lookups", () => ({ findOAuthAuthorizationCode: vi.fn(), findOAuthRefreshToken: vi.fn(), findOAuthRevocationToken: vi.fn() }));
vi.mock("@/data-access/oauth-grant-lifecycle", () => ({ revokeGeneration: vi.fn() }));
vi.mock("./oauth-eligibility", () => ({ assertGenerationEligible: vi.fn() }));

beforeEach(() => vi.resetAllMocks());
const authorize = (query: Record<string, string>) => oauthBefore({ path: "/oauth2/authorize", query } as Parameters<typeof oauthBefore>[0]);
it("defaults an allowlisted CIMD client to every requestable scope before registration", async () => {
  mocks.scopes.mockResolvedValue(undefined);
  expect(await authorize({ client_id: "https://listed.test/metadata", resource: "https://noma.test/api/mcp" }))
    .toMatchObject({ context: { query: { scope: OAUTH_REQUESTABLE_SCOPES.join(" ") } } });
});
it("limits a registered client's default to its grantable registration", async () => {
  mocks.scopes.mockResolvedValue(["feedstocks:read", "feedstocks:write", "feedstocks:delete", "unknown", "offline_access"]);
  expect(await authorize({ client_id: "registered", resource: "https://noma.test/api/mcp", scope: "  " }))
    .toMatchObject({ context: { query: { scope: "feedstocks:read feedstocks:write offline_access" } } });
});
it("keeps an explicit requested subset instead of widening it", async () => {
  mocks.scopes.mockResolvedValue(["feedstocks:read", "feedstocks:write", "orders:read", "offline_access"]);
  expect(await authorize({ client_id: "registered", resource: "https://noma.test/api/mcp", scope: "feedstocks:read offline_access" }))
    .toMatchObject({ context: { query: { scope: "feedstocks:read offline_access" } } });
  expect(mocks.scopes).toHaveBeenCalledWith("registered");
});
it("intersects replayed discovery scopes with a read-only registration", async () => {
  mocks.scopes.mockResolvedValue(["feedstocks:read", "offline_access"]);
  expect(await authorize({ client_id: "registered", resource: "https://noma.test/api/mcp", scope: OAUTH_REQUESTABLE_SCOPES.join(" ") }))
    .toMatchObject({ context: { query: { scope: "feedstocks:read offline_access" } } });
});
it("drops unregistered offline access without adding other registered scopes", async () => {
  mocks.scopes.mockResolvedValue(["feedstocks:read", "orders:write"]);
  expect(await authorize({ client_id: "registered", resource: "https://noma.test/api/mcp", scope: "feedstocks:read offline_access" }))
    .toMatchObject({ context: { query: { scope: "feedstocks:read" } } });
});
it.each([{ registration: [] }, { registration: ["orders:read"] }])("preserves a wholly unregistered request for provider rejection ($registration)", async ({ registration }) => {
  mocks.scopes.mockResolvedValue(registration);
  const scope = "  feedstocks:write  ";
  expect(await authorize({ client_id: "registered", resource: "https://noma.test/api/mcp", scope }))
    .toMatchObject({ context: { query: { scope } } });
});
it("leaves explicit scopes unchanged without a registration or CIMD default", async () => {
  mocks.scopes.mockResolvedValue(undefined);
  expect(await authorize({ client_id: "unknown-client", resource: "https://noma.test/api/mcp", scope: "feedstocks:write offline_access" }))
    .toMatchObject({ context: { query: { scope: "feedstocks:write offline_access" } } });
});
it("uses the allowlisted CIMD default for explicit scopes without widening", async () => {
  mocks.scopes.mockResolvedValue(undefined);
  expect(await authorize({ client_id: "https://listed.test/metadata", resource: "https://noma.test/api/mcp", scope: "feedstocks:write offline_access" }))
    .toMatchObject({ context: { query: { scope: "feedstocks:write offline_access" } } });
});
it("uses an allowlisted CIMD client's stored registration when available", async () => {
  mocks.scopes.mockResolvedValue(["feedstocks:read", "offline_access"]);
  expect(await authorize({ client_id: "https://listed.test/metadata", resource: "https://noma.test/api/mcp", scope: OAUTH_REQUESTABLE_SCOPES.join(" ") }))
    .toMatchObject({ context: { query: { scope: "feedstocks:read offline_access" } } });
});
it.each(["unknown", "feedstocks:delete"])("still rejects %s before filtering requestable scopes", async scope => {
  mocks.scopes.mockResolvedValue(["feedstocks:read", "offline_access"]);
  await expect(authorize({ client_id: "registered", resource: "https://noma.test/api/mcp", scope: `feedstocks:write ${scope} offline_access` }))
    .rejects.toMatchObject({ body: { error: "invalid_scope" } });
  expect(mocks.scopes).not.toHaveBeenCalled();
});
it("also intersects an explicit form authorization before provider validation", async () => {
  mocks.scopes.mockResolvedValue(["feedstocks:read", "offline_access"]);
  expect(await oauthBefore({ path: "/oauth2/authorize", method: "POST",
    request: new Request("https://noma.test/api/auth/oauth2/authorize", { method: "POST" }),
    body: { client_id: "registered", resource: "https://noma.test/api/mcp", scope: OAUTH_REQUESTABLE_SCOPES.join(" ") },
  } as Parameters<typeof oauthBefore>[0])).toMatchObject({ context: { body: { scope: "feedstocks:read offline_access" } } });
});
