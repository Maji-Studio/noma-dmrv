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

  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "biochar-products", label: "Biochar products and output stock", scopes: ["biochar-products:read", "biochar-products:write"] });
  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "formulations", label: "Formulations", scopes: ["formulations:read"] });
  expect(API_KEY_DEFAULT_SCOPES).toEqual(expect.arrayContaining(["biochar-products:read", "formulations:read"]));
  expect(API_KEY_DEFAULT_SCOPES).not.toContain("biochar-products:write");
  expect(API_PERMISSION_ROWS.flatMap((row) => row.scopes).some((scope) => scope.startsWith("stock-corrections"))).toBe(false);

  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "lab-samples", label: "Lab samples", scopes: ["lab-samples:read", "lab-samples:write", "lab-samples:delete"] });
  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "credit-batches", label: "Credit batches", scopes: ["credit-batches:read"] });
  expect(API_KEY_DEFAULT_SCOPES).toEqual(expect.arrayContaining(["lab-samples:read", "credit-batches:read"]));
  expect(API_KEY_DEFAULT_SCOPES).not.toContain("lab-samples:write");
  expect(API_KEY_DEFAULT_SCOPES).not.toContain("lab-samples:delete");
  expect(permissionSummary(["lab-samples:read", "lab-samples:write"])).toBe("Lab samples: Read, Write");
});
