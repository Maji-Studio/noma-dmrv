/**
 * Shared utilities for data-access layer
 */

import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
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
    throw new Error(
      `Referenced ${getTableName(table)} not found in this organization`,
    );
  }
}
