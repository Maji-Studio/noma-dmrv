import { expect, it } from "vitest";
import { apiKeyContext } from "../../../tests/helpers/api-context";
import { apiAudit } from "./audit";

it("keeps key attribution and leaves the OAuth client absent", () => {
  expect(apiAudit(apiKeyContext(), "request", "rest")).toEqual({
    requestId: "request", credentialId: "credential", transport: "rest", oauthClientId: undefined,
  });
});
it("attributes OAuth writes to the generation and client on both transports", () => {
  const ctx = apiKeyContext({ credentialId: "generation" });
  ctx.principal = { ...ctx.principal, kind: "oauth", oauthClientId: "client" };
  for (const transport of ["rest", "mcp"] as const) {
    expect(apiAudit(ctx, "request", transport)).toEqual({
      requestId: "request", credentialId: "generation", transport, oauthClientId: "client",
    });
  }
});
