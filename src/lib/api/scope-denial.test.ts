import { beforeEach, expect, it, vi } from "vitest";
import { apiKeyContext } from "../../../tests/helpers/api-context";
import { env } from "@/config/env";
import { apiScopeDenialResponse } from "./scope-denial";

const mocks = vi.hoisted(() => ({ record: vi.fn(), warn: vi.fn() }));
vi.mock("@/data-access/oauth-step-up", () => ({ recordOAuthStepUp: mocks.record }));
vi.mock("@/lib/log", () => ({ logger: { warn: mocks.warn } }));
vi.mock("@/config/env", () => ({ env: { OAUTH_PROVIDER_ENABLED: true, NEXT_PUBLIC_APP_URL: "https://noma.test" } }));
const ctx = { ...apiKeyContext({ scopes: ["feedstocks:read"] }),
  principal: { kind: "oauth" as const, userId: "user", credentialId: "grant", oauthClientId: "client" } };
beforeEach(() => { vi.resetAllMocks(); env.OAUTH_PROVIDER_ENABLED = true; });
it("records exactly the required scopes, not the challenge union", async () => {
  const response = await apiScopeDenialResponse(ctx, "/api/mcp", "id", ["feedstocks:write", "orders:write"]);
  expect(response.status).toBe(403);
  expect(response.headers.get("www-authenticate")).toContain('scope="feedstocks:read feedstocks:write orders:write"');
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ userId: ctx.userId, clientId: "client", organizationId: ctx.organizationId }, ["feedstocks:write", "orders:write"]);
  expect(mocks.warn).not.toHaveBeenCalled();
});
it("preserves the refusal when recording fails", async () => {
  const instance = "/api/v1/feedstocks?token=QUERY_SECRET";
  const expected = await apiScopeDenialResponse(ctx, instance, "id", ["feedstocks:write"]);
  mocks.record.mockRejectedValue(new Error("Storage unavailable: Bearer TOKEN_SECRET"));
  const response = await apiScopeDenialResponse(ctx, instance, "id", ["feedstocks:write"]);
  expect(response.status).toBe(expected.status);
  expect([...response.headers]).toEqual([...expected.headers]);
  expect(await response.json()).toEqual(await expected.json());
  expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({
    op: "oauth.recordStepUp", requestId: "id", userId: ctx.userId, clientId: "client", organizationId: ctx.organizationId,
  }, "OAuth step-up hint recording failed");
});
it("records nothing for keys, deletes, empty requirements, disallowed roles or a disabled provider", async () => {
  await apiScopeDenialResponse(apiKeyContext(), "/api/v1/feedstocks", "id", ["feedstocks:write"]);
  await apiScopeDenialResponse(ctx, "/api/mcp", "id", ["feedstocks:delete"]);
  await apiScopeDenialResponse(ctx, "/api/mcp", "id", []);
  // Runtime refusal also defends against an unrecognized role in stored state.
  await apiScopeDenialResponse({ ...ctx, orgRole: "unknown" as "member" }, "/api/mcp", "id", ["feedstocks:write"]);
  env.OAUTH_PROVIDER_ENABLED = false;
  await apiScopeDenialResponse(ctx, "/api/mcp", "id", ["feedstocks:write"]);
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.warn).not.toHaveBeenCalled();
});
