import { beforeEach, expect, it, vi } from "vitest";
import { getOAuthOrganizationChoicesFn } from "./oauth";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), session: vi.fn(), selection: vi.fn(), client: vi.fn(), resolve: vi.fn() }));
vi.mock("@better-auth/oauth-provider", () => ({ verifyOAuthQueryParams: mocks.verify, getOAuthProviderState: vi.fn() }));
vi.mock("@/lib/auth/better-auth", () => ({ auth: { $context: Promise.resolve({ secret: "unit-test-secret" }) } }));
vi.mock("@/lib/auth/providers/better-auth-server", () => ({ getBetterAuthSession: mocks.session }));
vi.mock("@/config/env", () => ({ env: { OAUTH_PROVIDER_ENABLED: true, NEXT_PUBLIC_APP_URL: "https://noma.test" } }));
vi.mock("@/data-access/oauth-grant-lifecycle", () => ({ getOAuthOrganizationSelection: mocks.selection, selectOAuthOrganization: vi.fn(), resolveAttemptGrant: mocks.resolve }));
vi.mock("@/data-access/oauth-provider", () => ({ findOAuthClient: mocks.client, findOAuthClientResources: vi.fn(), findOAuthAttempt: vi.fn(), getOAuthAttemptConsent: vi.fn() }));
vi.mock("@/lib/auth/oauth-eligibility", () => ({ assertGenerationEligible: vi.fn() }));
vi.mock("@/data-access/oauth-grants", () => ({ listOwnOAuthGrants: vi.fn(), listAllOAuthGrants: vi.fn(), revokeOAuthGrant: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, sanitizeErrorMessage: () => "error" }));

const oauthQuery = new URLSearchParams({ client_id: "https://client.test/metadata", redirect_uri: "https://callback.test/oauth", code_challenge: "challenge", resource: "https://noma.test/api/mcp", ba_pl: "session", scope: "feedstocks:read offline_access" }).toString();
beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue(true);
  mocks.resolve.mockResolvedValue({ id: "generation" });
  mocks.session.mockResolvedValue({ user: { id: "user", emailVerified: true }, session: { id: "session" } });
  mocks.client.mockResolvedValue({ name: "Example app", disabled: false });
  mocks.selection.mockResolvedValue({ memberships: [{ organizationId: "org", memberId: "member", name: "Organization", role: "member", disabledReason: "API access is disabled." }], preselectedOrganizationId: null });
});
it("returns disabled membership choices without requiring an active organization", async () => {
  expect(await getOAuthOrganizationChoicesFn({ oauthQuery })).toEqual({ success: true, data: {
    clientName: "Example app", clientHost: "client.test", redirectHost: "callback.test",
    memberships: [{ organizationId: "org", name: "Organization", role: "member", disabledReason: "API access is disabled." }], preselectedOrganizationId: null,
  } });
});
it("refuses an invalid signed query before reading memberships", async () => {
  mocks.verify.mockResolvedValue(false);
  expect(await getOAuthOrganizationChoicesFn({ oauthQuery })).toMatchObject({ success: false });
  expect(mocks.selection).not.toHaveBeenCalled();
});

it("returns only a verified post-login continuation bound to the current session", async () => {
  const { selectOAuthOrganizationFn } = await import("./oauth");
  const { selectOAuthOrganization } = await import("@/data-access/oauth-grant-lifecycle");
  expect(await selectOAuthOrganizationFn({ oauthQuery, organizationId: "org" })).toEqual({
    success: true, data: { oauth_query: oauthQuery, postLogin: true },
  });
  expect(selectOAuthOrganization).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session", userId: "user", organizationId: "org" }));
  const firstKey = vi.mocked(selectOAuthOrganization).mock.calls[0][0].attemptKey;
  mocks.session.mockResolvedValue({ user: { id: "user", emailVerified: true }, session: { id: "other-session" } });
  await selectOAuthOrganizationFn({ oauthQuery: oauthQuery.replace("ba_pl=session&", ""), organizationId: "org" });
  expect(vi.mocked(selectOAuthOrganization).mock.calls[1][0].attemptKey).not.toBe(firstKey);
});

it("refuses a consent continuation signed for another session", async () => {
  const { selectOAuthOrganizationFn } = await import("./oauth");
  expect(await selectOAuthOrganizationFn({ oauthQuery: oauthQuery.replace("ba_pl=session", "ba_pl=other-session"), organizationId: "org" })).toMatchObject({ success: false });
});

it("reads consent organization and allowed scopes from the bound generation", async () => {
  const { getOAuthConsentViewFn } = await import("./oauth");
  const { getOAuthAttemptConsent } = await import("@/data-access/oauth-provider");
  const { assertGenerationEligible } = await import("@/lib/auth/oauth-eligibility");
  vi.mocked(getOAuthAttemptConsent).mockResolvedValue({ organizationId: "bound-org", name: "Bound organization", grantId: "generation", consentScopes: ["feedstocks:read"] });
  vi.mocked(assertGenerationEligible).mockResolvedValue({ ok: true, role: "member" });
  expect(await getOAuthConsentViewFn({ oauthQuery: oauthQuery.replace("feedstocks%3Aread", "feedstocks%3Aread+feedstocks%3Awrite"), organizationId: "forged-org", scopes: ["orders:write"] })).toMatchObject({ success: true, data: {
    organization: { id: "bound-org", name: "Bound organization" }, newlyRequestedScopes: ["feedstocks:write"],
    alreadyAllowedScopes: ["feedstocks:read"], offlineAccessRequested: true, isStepUp: true,
  } });
});

it.each(["member", "admin", "owner"] as const)("lists grants for the authenticated %s role", async role => {
  const { listOAuthGrantsFn } = await import("./oauth");
  const { requireOrgContext } = await import("@/lib/auth/server");
  const { listOwnOAuthGrants, listAllOAuthGrants } = await import("@/data-access/oauth-grants");
  vi.mocked(requireOrgContext).mockResolvedValue({ userId: "user", organizationId: "org", orgRole: role, isPlatformAdmin: false });
  vi.mocked(listOwnOAuthGrants).mockResolvedValue([]);
  vi.mocked(listAllOAuthGrants).mockResolvedValue([]);
  expect(await listOAuthGrantsFn()).toEqual({ success: true, data: [] });
  expect(role === "member" ? listOwnOAuthGrants : listAllOAuthGrants).toHaveBeenCalled();
  expect(role === "member" ? listAllOAuthGrants : listOwnOAuthGrants).not.toHaveBeenCalled();
});

it("preserves a stale revoke conflict and validates the version before writing", async () => {
  const { revokeOAuthGrantFn } = await import("./oauth");
  const { requireOrgContext } = await import("@/lib/auth/server");
  const { revokeOAuthGrant } = await import("@/data-access/oauth-grants");
  const { assertRowVersion } = await import("@/data-access/row-version");
  vi.mocked(requireOrgContext).mockResolvedValue({ userId: "user", organizationId: "org", orgRole: "member", isPlatformAdmin: false });
  vi.mocked(revokeOAuthGrant).mockImplementation(async () => {
    assertRowVersion({ entity: "oauth-grant", id: "grant", expectedVersion: 1, actualVersion: 2 });
    return { id: "grant" };
  });
  expect(await revokeOAuthGrantFn({ id: "grant", expectedVersion: 1 })).toMatchObject({ success: false, code: "stale_version", conflict: { entity: "oauth-grant", id: "grant", code: "stale-version" } });
  vi.mocked(revokeOAuthGrant).mockClear();
  expect(await revokeOAuthGrantFn({ id: "grant" })).toMatchObject({ success: false, code: "validation_failed" });
  expect(revokeOAuthGrant).not.toHaveBeenCalled();
});

it("rejects tampering and expiry with the installed plugin's real signature verifier", async () => {
  const { verifyOAuthQueryParams } = await vi.importActual<typeof import("@better-auth/oauth-provider")>("@better-auth/oauth-provider");
  const { makeSignature } = await import("better-auth/crypto");
  const { MILLISECONDS_PER_SECOND } = await import("@/config/api-keys");
  const VALID_SECONDS = 60;
  mocks.verify.mockImplementation(verifyOAuthQueryParams);
  const params = new URLSearchParams(oauthQuery);
  const expiry = Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + VALID_SECONDS;
  params.set("exp", String(expiry));
  params.sort();
  params.set("sig", await makeSignature(params.toString(), "unit-test-secret"));
  expect((await getOAuthOrganizationChoicesFn({ oauthQuery: params.toString() })).success).toBe(true);
  expect((await getOAuthOrganizationChoicesFn({ oauthQuery: `${params}&scope=orders:write` })).success).toBe(false);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime((expiry + 1) * MILLISECONDS_PER_SECOND);
    expect((await getOAuthOrganizationChoicesFn({ oauthQuery: params.toString() })).success).toBe(false);
  } finally { vi.useRealTimers(); }
});

it("requires a verified session before displaying client information", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await getOAuthOrganizationChoicesFn({ oauthQuery })).success).toBe(false);
  mocks.session.mockResolvedValue({ user: { id: "user", emailVerified: false }, session: { id: "session" } });
  expect((await getOAuthOrganizationChoicesFn({ oauthQuery })).success).toBe(false);
  expect(mocks.client).not.toHaveBeenCalled();
});

it("refuses consent without a bound attempt or with an ineligible generation", async () => {
  const { getOAuthConsentViewFn } = await import("./oauth");
  const { getOAuthAttemptConsent } = await import("@/data-access/oauth-provider");
  const { assertGenerationEligible } = await import("@/lib/auth/oauth-eligibility");
  expect((await getOAuthConsentViewFn({ oauthQuery })).success).toBe(false);
  vi.mocked(getOAuthAttemptConsent).mockResolvedValue({ organizationId: "org", name: "Organization", grantId: "grant", consentScopes: [] });
  vi.mocked(assertGenerationEligible).mockResolvedValue({ ok: false, denial: "api_access_disabled" });
  expect((await getOAuthConsentViewFn({ oauthQuery })).success).toBe(false);
});

it("resolves a forced-consent attempt before reading its view", async () => {
  const { getOAuthConsentViewFn } = await import("./oauth");
  const { getOAuthAttemptConsent } = await import("@/data-access/oauth-provider");
  const { assertGenerationEligible } = await import("@/lib/auth/oauth-eligibility");
  vi.mocked(assertGenerationEligible).mockResolvedValue({ ok: true, role: "member" });
  vi.mocked(getOAuthAttemptConsent).mockImplementation(async () => {
    if (!mocks.resolve.mock.calls.length) throw new Error("Attempt generation has not been resolved");
    return { organizationId: "org", name: "Organization", grantId: "generation", consentScopes: ["feedstocks:read"] };
  });
  expect(await getOAuthConsentViewFn({ oauthQuery: `${oauthQuery}&prompt=consent` })).toMatchObject({ success: true, data: { isStepUp: false, newlyRequestedScopes: [] } });
});
it("requires the consent query to carry the current session binding", async () => {
  const { getOAuthConsentViewFn } = await import("./oauth");
  const query = new URLSearchParams(oauthQuery);
  query.delete("ba_pl");
  const { getOAuthAttemptConsent } = await import("@/data-access/oauth-provider");
  const { assertGenerationEligible } = await import("@/lib/auth/oauth-eligibility");
  vi.mocked(getOAuthAttemptConsent).mockResolvedValue({ organizationId: "org", name: "Organization", grantId: "generation", consentScopes: [] });
  vi.mocked(assertGenerationEligible).mockResolvedValue({ ok: true, role: "member" });
  expect(await getOAuthConsentViewFn({ oauthQuery: query.toString() })).toMatchObject({ success: false, error: "Start again from the app." });
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it("logs only error classification for unexpected OAuth failures", async () => {
  const { logger } = await import("@/lib/log");
  mocks.selection.mockRejectedValue(Object.assign(new Error("private@example.test oauth_query=signed-secret access_token=secret"), { code: "ECONNRESET", input: oauthQuery }));
  expect(await getOAuthOrganizationChoicesFn({ oauthQuery })).toMatchObject({ success: false, error: "Start again from the app." });
  expect(logger.error).toHaveBeenCalledExactlyOnceWith({ errorName: "Error", code: "ECONNRESET" }, "OAuth action failed");
});
it("does not log expected OAuth refusals", async () => {
  const { logger } = await import("@/lib/log");
  mocks.verify.mockResolvedValue(false);
  await getOAuthOrganizationChoicesFn({ oauthQuery });
  expect(logger.error).not.toHaveBeenCalled();
});

it("does not log arbitrary error metadata or input", async () => {
  const { logger } = await import("@/lib/log");
  mocks.selection.mockRejectedValue(Object.assign(new Error("signed-query-secret"), { name: "private@example.test", code: "token-secret", input: oauthQuery }));
  await getOAuthOrganizationChoicesFn({ oauthQuery });
  expect(logger.error).toHaveBeenCalledExactlyOnceWith({ errorName: "Error", code: "unexpected_error" }, "OAuth action failed");
});
