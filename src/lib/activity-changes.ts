import { getTableColumns } from "drizzle-orm";
import type { ActivityChanges, ActivityValue } from "@/db/schema/activity";
import { activityCoordinatePairs, activityFieldPolicies } from "./activity-field-policy";
export { activityFieldPolicies } from "./activity-field-policy";

export type ActivitySnapshot = Readonly<Record<string, unknown>>;
export type CaptureActivity = (entityId: string, before: ActivitySnapshot | null, after: ActivitySnapshot | null) => void;

/** Decimal normalization without binary floating-point conversion. */
function decimal(value: unknown): string {
  const text = String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const point = whole.length + Number(exponent);
  const digits = whole + fraction;
  const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
    : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [integer, tail = ""] = expanded.split(".");
  const normalized = (integer.replace(/^0+(?=\d)/, "") || "0") + (tail.replace(/0+$/, "") ? `.${tail.replace(/0+$/, "")}` : "");
  return sign === "-" && normalized !== "0" ? `-${normalized}` : normalized;
}

const NESTED_BOOKKEEPING_KEYS = new Set(["id", "organizationId", "createdAt", "updatedAt", "version"]);

function canonical(value: unknown, nested = false): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => canonical(item, true))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !NESTED_BOOKKEEPING_KEYS.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, true)]));
  if (nested && (typeof value === "number" || typeof value === "string")) return decimal(value);
  return value;
}

/** Compare persisted snapshots; no request fields or values enter the event implicitly. */
export function diffActivityChanges(entityType: string, before: ActivitySnapshot | null, after: ActivitySnapshot | null): { changedFields: string[]; changes: ActivityChanges } {
  const changedFields: string[] = [];
  const changes: ActivityChanges = {};
  if (!after) return { changedFields, changes };
  const policy = Object.hasOwn(activityFieldPolicies, entityType) ? activityFieldPolicies[entityType] : undefined;
  const columns = policy ? getTableColumns(policy.table) : {};
  const normalize = (field: string, value: unknown): unknown => {
    if (value == null) return null;
    const column = columns[field];
    if (column?.dataType === "number" || column?.getSQLType().startsWith("numeric")) return decimal(value);
    if (column?.getSQLType() === "date") return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    if (column?.dataType === "date") return new Date(value as string | number | Date).toISOString();
    return canonical(value);
  };
  const scalar = (value: unknown): value is ActivityValue => value === null || ["string", "number", "boolean"].includes(typeof value);
  for (const field of [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].sort()) {
    const classification = policy && Object.hasOwn(policy.fields, field) ? policy.fields[field] : "name";
    if (classification === "ignore") continue;
    const from = normalize(field, before?.[field]);
    const to = normalize(field, after[field]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changedFields.push(field);
    if (classification !== "name" && scalar(from) && scalar(to)) changes[field] = { from, to };
  }
  const pairs = Object.hasOwn(activityCoordinatePairs, entityType) ? activityCoordinatePairs[entityType] : [];
  for (const pair of pairs) {
    if (!pair.some(field => changedFields.includes(field))) continue;
    for (const field of pair) {
      const from = normalize(field, before?.[field]);
      const to = normalize(field, after[field]);
      if (scalar(from) && scalar(to)) changes[field] = { from, to };
    }
  }
  return { changedFields, changes };
}
