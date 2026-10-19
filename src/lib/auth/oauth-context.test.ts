import { beforeEach, expect, it, vi } from "vitest";
import { OAUTH_IDLE_LIMIT_MS } from "@/config/oauth";
import { resolveOAuthContext } from "./oauth-context";
import { hashOAuthAccessToken } from "./oauth-token-hash";

const mocks = vi.hoisted(() => ({ enabled: true, token: vi.fn(), eligibility: vi.fn(), client: vi.fn(), consent: vi.fn(), touch: vi.fn(), revoke: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { get OAUTH_PROVIDER_ENABLED() { return mocks.enabled; } } }));
vi.mock("@/data-access/oauth-credential-auth", () => ({ findOAuthCredential: mocks.token, findOAuthGenerationEligibility: mocks.eligibility,
  findOAuthClient: mocks.client, findOAuthConsent: mocks.consent, touchOAuthGeneration: mocks.touch }));
vi.mock("@/data-access/oauth-grant-lifecycle", () => ({ revokeGeneration: mocks.revoke }));
const audience = "https://app.example.com/api/v1";
const bearer = "noma_oat_synthetic";
const grant = { id: "grant", memberId: "member", userId: "user", organizationId: "org", clientId: "client", resource: audience, revokedAt: null, lastUsedAt: new Date() };
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled = true;
  mocks.token.mockResolvedValue({ grant, token: { userId: "user", revoked: null, clientId: "client", resources: [audience], confirmation: null, scopes: ["feedstocks:read", "feedstocks:write", "feedstocks:delete"], expiresAt: new Date("2100-01-01") } });
  mocks.eligibility.mockResolvedValue({ grant, member: { id: "member", role: "member" }, emailVerified: true, apiEnabled: true });
  mocks.client.mockResolvedValue({ name: null, disabled: false });
  mocks.consent.mockResolvedValue({ scopes: ["feedstocks:read", "feedstocks:delete"] });
});
it("fails closed while disabled without touching storage", async () => {
  mocks.enabled = false;
  expect(await resolveOAuthContext(bearer, audience)).toEqual({ ok: false, denial: "credential_invalid" });
  expect(mocks.token).not.toHaveBeenCalled();
});
it("looks up the provider-compatible hash and grants only consented role-eligible scopes", async () => {
  expect(await resolveOAuthContext(bearer, audience)).toMatchObject({ ok: true, ctx: { credentialId: "grant", orgRole: "member", scopes: ["feedstocks:read"], principal: { kind: "oauth" } } });
  expect(mocks.token).toHaveBeenCalledWith(await hashOAuthAccessToken(bearer));
});
it("does not refresh inactivity before rejecting and revoking the generation", async () => {
  mocks.eligibility.mockResolvedValue({ grant: { ...grant, lastUsedAt: new Date(Date.now() - OAUTH_IDLE_LIMIT_MS) }, member: { id: "member", role: "member" }, emailVerified: true, apiEnabled: false });
  expect(await resolveOAuthContext(bearer, audience)).toEqual({ ok: false, denial: "credential_expired" });
  expect(mocks.revoke).toHaveBeenCalledWith("grant", "inactive");
  expect(mocks.touch).not.toHaveBeenCalled();
});
it.each([
  [{ member: null, emailVerified: false, grant: { ...grant, revokedAt: new Date() } }, "credential_owner_removed"],
  [{ emailVerified: false, grant: { ...grant, revokedAt: new Date() } }, "credential_owner_unverified"],
  [{ grant: { ...grant, revokedAt: new Date(), lastUsedAt: new Date(0) } }, "credential_revoked"],
  [{ apiEnabled: false }, "api_access_disabled"],
])("preserves eligibility denial precedence", async (override, denial) => {
  mocks.eligibility.mockResolvedValue({ grant, member: { id: "member", role: "member" }, emailVerified: true, apiEnabled: true, ...override });
  expect(await resolveOAuthContext(bearer, audience)).toEqual({ ok: false, denial });
  expect(mocks.touch).not.toHaveBeenCalled();
});
it.each([
  { grant: null },
  { token: { clientId: "other", confirmation: null } },
  { token: { clientId: "client", confirmation: {} } },
])("refuses missing binding, client mismatch and sender-bound tokens before eligibility", async override => {
  mocks.token.mockResolvedValue({ grant, token: { confirmation: null, clientId: "client" }, ...override });
  expect(await resolveOAuthContext(bearer, audience)).toEqual({ ok: false, denial: "credential_invalid" });
  expect(mocks.eligibility).not.toHaveBeenCalled();
});

it("refuses plugin-revoked access tokens", async () => {
  const stored = await mocks.token();
  mocks.token.mockResolvedValue({ ...stored, token: { ...stored.token, revoked: new Date() } });
  expect(await resolveOAuthContext(bearer, audience)).toEqual({ ok: false, denial: "credential_revoked" });
  expect(mocks.touch).not.toHaveBeenCalled();
});
it("refuses a token bound to another user", async () => {
  const stored = await mocks.token();
  mocks.token.mockResolvedValue({ ...stored, token: { ...stored.token, userId: "other" } });
  expect(await resolveOAuthContext(bearer, audience)).toEqual({ ok: false, denial: "credential_invalid" });
});
it("refuses a generation with no consent without recording activity", async () => {
  mocks.consent.mockResolvedValue(undefined);
  expect(await resolveOAuthContext(bearer, audience)).toEqual({ ok: false, denial: "credential_revoked" });
  expect(mocks.touch).not.toHaveBeenCalled();
});
