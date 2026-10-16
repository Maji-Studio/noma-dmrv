import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { activityEvents } from "@/db/schema";

export const apiAuditColumns = {
  transport: activityEvents.source,
  operationId: activityEvents.operationId,
};

/** Check the non-null invariant guaranteed by apiActivityWhere without losing extra columns. */
export function toApiAuditRow<T extends { operationId: string | null }>(row: T) {
  if (row.operationId === null) throw new Error("API audit row is missing operationId.");
  return { ...row, operationId: row.operationId };
}

export function apiActivityWhere(organizationId: string, ...extra: (SQL | undefined)[]) {
  return and(
    eq(activityEvents.organizationId, organizationId),
    inArray(activityEvents.source, ["rest", "mcp"]),
    isNotNull(activityEvents.operationId),
    ...extra,
  );
}

export function stringifyWithBigint(value: unknown) {
  return JSON.stringify(value, (_key, value) => typeof value === "bigint" ? String(value) : value);
}
