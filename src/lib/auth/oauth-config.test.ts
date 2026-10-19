import { expect, it } from "vitest";
import { assertOAuthIssuer, deriveOAuthConfig } from "./oauth-config";

it.each(["http://localhost:3100", "http://127.0.0.1:4100", "https://staging.app.noma.maji.studio", "https://app.noma.maji.studio"])("derives issuer and distinct audiences from %s", origin => {
  expect(deriveOAuthConfig(`${origin}/`)).toEqual({ issuer: `${origin}/api/auth`, rest: `${origin}/api/v1`, mcp: `${origin}/api/mcp` });
  expect(() => assertOAuthIssuer(`${origin}/api/auth`, origin)).not.toThrow();
  expect(() => assertOAuthIssuer(origin, origin)).toThrow("issuer");
});
