export const API_SCOPES = [
  "applications:read", "applications:write", "applications:delete",
  "production-runs:read", "production-runs:write", "production-runs:delete", "reactors:read",
  "biochar-products:read", "biochar-products:write", "formulations:read", "formulations:write", "formulations:delete",
  "feedstocks:read", "feedstocks:write", "feedstocks:delete",
  "facilities:read", "suppliers:read", "suppliers:write", "suppliers:delete", "feedstock-types:read",
  "storage-locations:read", "vehicles:read", "drivers:read",
  "deliveries:read", "deliveries:write",
  "customers:read", "customers:write", "customers:delete", "orders:read", "orders:write", "orders:delete",
  "lab-samples:read", "lab-samples:write", "lab-samples:delete", "credit-batches:read",
] as const;
export type ApiScope = typeof API_SCOPES[number];
