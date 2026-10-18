import { describe, expect, it } from "vitest";
import { guardOAuthAuthorize, guardOAuthTokenInput, refreshDecision } from "./oauth-request-policy";

describe("OAuth request boundary", () => {
  it.each(["feedstocks:delete", "openid", "unknown"])("refuses ungrantable scope %s", scope => {
    expect(() => guardOAuthAuthorize({ scope })).toThrow();
  });
  it("allows read and offline access without changing the query", () => {
    const query = Object.freeze({ scope: "feedstocks:read offline_access", resource: "https://example.test/api/mcp" });
    expect(() => guardOAuthAuthorize(query)).not.toThrow();
  });
  it("refuses multiple resources and DPoP", () => {
    expect(() => guardOAuthAuthorize({ resource: ["a", "b"] })).toThrow();
    expect(() => guardOAuthAuthorize({ dpop_jkt: "" })).toThrow();
    expect(() => guardOAuthTokenInput({}, new Headers({ DPoP: "" }))).toThrow();
    expect(() => guardOAuthTokenInput({ grant_type: "client_credentials" })).toThrow();
  });
  it("keeps the replay boundary inclusive and rejects non-rotation revocations", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    expect(refreshDecision({ revoked: now, rotatedAt: new Date(now.getTime() - 30_000) }, now)).toBe("pass");
    expect(refreshDecision({ revoked: now, rotatedAt: new Date(now.getTime() - 30_001) }, now)).toBe("reuse");
    expect(refreshDecision({ revoked: now, rotatedAt: null }, now)).toBe("refuse");
    expect(refreshDecision({ revoked: null, rotatedAt: null }, now)).toBe("pass");
  });
});
