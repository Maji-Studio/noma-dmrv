import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { activityEvents } from "@/db/schema";

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
