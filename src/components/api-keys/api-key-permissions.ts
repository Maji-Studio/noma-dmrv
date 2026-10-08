import { API_SCOPES, type ApiScope } from "@/lib/auth/api-scopes";
import { MISSING_VALUE } from "@/lib/copy-utils";

const ENTITY_LABELS: Record<string, string> = {
  feedstocks: "Feedstocks",
  facilities: "Facilities",
  suppliers: "Suppliers",
  "feedstock-types": "Feedstock types",
  "storage-locations": "Storage bins",
  vehicles: "Vehicles",
  drivers: "Drivers",
};
export const API_PERMISSION_ACTIONS = ["read", "write", "delete"] as const;
export const API_PERMISSION_LABELS = { read: "Read", write: "Write", delete: "Delete" };
export const API_PERMISSION_ROWS = [...new Set(API_SCOPES.map((scope) => scope.split(":")[0]))]
  .map((entity) => ({
    entity,
    label: ENTITY_LABELS[entity],
    scopes: API_SCOPES.filter((scope) => scope.startsWith(`${entity}:`)),
  }));
export const API_KEY_DEFAULT_SCOPES = API_SCOPES.filter((scope) => scope.endsWith(":read"));

export function permissionSummary(scopes: readonly ApiScope[]) {
  return API_PERMISSION_ROWS.flatMap((row) => {
    const actions = API_PERMISSION_ACTIONS.filter((action) =>
      scopes.some((scope) => scope === `${row.entity}:${action}`));
    return actions.length ? [`${row.label}: ${actions.map((action) => API_PERMISSION_LABELS[action]).join(", ")}`] : [];
  }).join("; ") || MISSING_VALUE.none;
}
