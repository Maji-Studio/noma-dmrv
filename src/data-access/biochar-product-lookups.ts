/**
 * Biochar product lookup queries — code availability and dropdown options.
 * Split from `biochar-products.ts` to keep that file under the line cap.
 */

import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

/**
 * Check if a biochar product code is available
 */
export async function isBiocharProductCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeProductId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.code, code)];

  if (excludeProductId) {
    conditions.push(sql`${biocharProducts.id} != ${excludeProductId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
  const [existing] = await db
    .select({ id: biocharProducts.id })
    .from(biocharProducts)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get biochar product options for dropdowns
 * Returns minimal data needed for select inputs
 */
export async function getBiocharProductOptions(
  ctx: OrgContext
): Promise<Array<{ id: string; code: string }>> {
  requireOrgScope(ctx);

  return db
    .select({
      id: biocharProducts.id,
      code: biocharProducts.code,
    })
    .from(biocharProducts)
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), isNull(biocharProducts.archivedAt)))
    .orderBy(desc(biocharProducts.productionDate));
}
