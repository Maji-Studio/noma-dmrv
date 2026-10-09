import { expect, it } from "vitest";
import { API_KEY_DEFAULT_SCOPES, API_PERMISSION_ROWS, permissionSummary } from "./api-key-permissions";
it("offers production permissions and defaults new workflow reads on and mutations off", () => {
  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "production-runs", label: "Production runs", scopes: ["production-runs:read", "production-runs:write", "production-runs:delete"] });
  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "reactors", label: "Reactors", scopes: ["reactors:read"] });
  expect(API_KEY_DEFAULT_SCOPES).toContain("production-runs:read");
  expect(API_KEY_DEFAULT_SCOPES).toContain("reactors:read");
  expect(API_KEY_DEFAULT_SCOPES.some((scope) => !scope.endsWith(":read"))).toBe(false);
  expect(permissionSummary(["production-runs:read", "production-runs:write", "reactors:read"]))
    .toBe("Production runs: Read, Write; Reactors: Read");
});
