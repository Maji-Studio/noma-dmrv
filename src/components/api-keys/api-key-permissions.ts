import { API_SCOPES, type ApiScope } from "@/lib/auth/api-scopes";
import { MISSING_VALUE } from "@/lib/copy-utils";

const ENTITY_LABELS: Record<string, string> = {
  applications: "Applications",
  "production-runs": "Production runs",
  reactors: "Reactors",
  "biochar-products": "Biochar products and output stock",
  formulations: "Formulations",
  feedstocks: "Feedstocks",
  facilities: "Facilities",
  suppliers: "Suppliers",
  customers: "Customers",
  orders: "Orders",
  deliveries: "Deliveries",
  "feedstock-types": "Feedstock types",
  "storage-locations": "Storage bins",
  vehicles: "Vehicles",
  drivers: "Drivers",
  "lab-samples": "Lab samples",
  "credit-batches": "Credit batches",
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

const EVERYTHING = "everything";
const ACCESS_VERBS = { read: "reads", write: "saves", delete: "deletes" } as const;

/**
 * The short permission line for lists, such as "Reads everything; saves Feedstocks, Orders".
 * An action granted on every entity that offers it collapses to "everything"; otherwise the entities are named.
 */
export function compactPermissionSummary(scopes: readonly ApiScope[]): string {
  const granted = new Set<string>(scopes);
  const parts = API_PERMISSION_ACTIONS.flatMap((action) => {
    const offered = API_PERMISSION_ROWS.filter((row) => row.scopes.some((scope) => scope.endsWith(`:${action}`)));
    const held = offered.filter((row) => granted.has(`${row.entity}:${action}`));
    if (!held.length) return [];
    const what = held.length === offered.length ? EVERYTHING : held.map((row) => row.label).join(", ");
    return [`${ACCESS_VERBS[action]} ${what}`];
  });
  if (!parts.length) return MISSING_VALUE.none;
  const line = parts.join("; ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
