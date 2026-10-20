import { beforeEach, expect, it, vi } from "vitest";
import { oauthBefore } from "./oauth-hooks";
import { OAUTH_REQUESTABLE_SCOPES } from "./oauth-scopes";

const mocks = vi.hoisted(() => ({ scopes: vi.fn() }));
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
  expect(await authorize({ client_id: "registered", resource: "https://noma.test/api/mcp", scope: "feedstocks:read offline_access" }))
    .toMatchObject({ context: { query: { scope: "feedstocks:read offline_access" } } });
  expect(mocks.scopes).not.toHaveBeenCalled();
});
