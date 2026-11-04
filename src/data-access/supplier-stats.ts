import { db } from "@/db";
import { suppliers } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { requireOrgScope } from "./utils";

export interface SupplierStats {
  totalSuppliers: number;
}

export interface SupplierStatsFilters {
  archived?: boolean;
}

export async function getSupplierStats(
  ctx: OrgContext,
  filters?: SupplierStatsFilters,
): Promise<SupplierStats> {
  requireOrgScope(ctx);
  const [stats] = await db.select({ totalSuppliers: count() })
    .from(suppliers)
    .where(and(
      eq(suppliers.organizationId, ctx.organizationId),
      filters?.archived ? isNotNull(suppliers.archivedAt) : isNull(suppliers.archivedAt),
    ));
  return { totalSuppliers: Number(stats.totalSuppliers) };
}
