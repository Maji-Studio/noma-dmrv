/**
 * Shared utilities for data-access layer
 */

import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { and, eq, getTableName } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";

type OrgScopedTable = AnyPgTable & {
  id: AnyPgColumn;
  organizationId: AnyPgColumn;
};

/**
 * Require a complete organization-scoped request context.
 */
export function requireOrgScope(ctx: OrgContext): void {
  if (!ctx.userId.trim() || !ctx.organizationId.trim()) {
    throw new Error("Unauthorized");
  }
}

/** Assert that a referenced domain row belongs to the active organization. */
export async function assertSameOrg(
  ctx: OrgContext,
  table: OrgScopedTable,
  id: string,
): Promise<void> {
  requireOrgScope(ctx);
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.id, id),
        eq(table.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new SafeError(
      `${humanizeTableName(getTableName(table))} not found in this organization`,
    );
  }
}

/** "credit_batches" → "Credit batch" — user-facing entity name for errors. */
function humanizeTableName(tableName: string): string {
  const words = tableName.split("_").join(" ");
  const singular = words.endsWith("ies")
    ? `${words.slice(0, -3)}y`
    : /(?:ch|sh|x|ss|z)es$/.test(words)
      ? words.slice(0, -2)
      : words.endsWith("s")
        ? words.slice(0, -1)
        : words;
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}
