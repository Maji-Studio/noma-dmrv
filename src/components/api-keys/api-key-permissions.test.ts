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

it("defaults customer and order reads on and order mutations off", () => {
  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "customers", label: "Customers", scopes: ["customers:read"] });
  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "orders", label: "Orders", scopes: ["orders:read", "orders:write", "orders:delete"] });
  expect(API_KEY_DEFAULT_SCOPES).toContain("customers:read");
  expect(API_KEY_DEFAULT_SCOPES).toContain("orders:read");
  expect(API_KEY_DEFAULT_SCOPES).not.toContain("orders:write");
  expect(API_KEY_DEFAULT_SCOPES).not.toContain("orders:delete");
  expect(permissionSummary(["customers:read", "orders:read", "orders:write", "orders:delete"]))
    .toBe("Customers: Read; Orders: Read, Write, Delete");
});

it("keeps delivery writes opt-in and offers no delivery deletion", () => {
  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "deliveries", label: "Deliveries", scopes: ["deliveries:read", "deliveries:write"] });
  expect(API_KEY_DEFAULT_SCOPES).toContain("deliveries:read");
  expect(API_KEY_DEFAULT_SCOPES).not.toContain("deliveries:write");
  expect(permissionSummary(["deliveries:write"])).toBe("Deliveries: Write");
});

it("gives every permission row a nonempty label", () => {
  for (const row of API_PERMISSION_ROWS) {
    expect(row.label, row.entity).toBeTypeOf("string");
    expect(row.label.trim(), row.entity).not.toBe("");
  }
});

it("defaults application reads on and requires opting into mutations", () => {
  expect(API_PERMISSION_ROWS).toContainEqual({ entity: "applications", label: "Applications", scopes: ["applications:read", "applications:write", "applications:delete"] });
  expect(API_KEY_DEFAULT_SCOPES).toContain("applications:read");
  expect(API_KEY_DEFAULT_SCOPES).not.toContain("applications:write");
  expect(API_KEY_DEFAULT_SCOPES).not.toContain("applications:delete");
});
