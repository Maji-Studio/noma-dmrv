import { db } from "@/db";
import { formulations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { requireOrgScope } from "./utils";

export interface FormulationStats {
  totalFormulations: number;
}

export interface FormulationStatsFilters {
  archived?: boolean;
}

export async function getFormulationStats(
  ctx: OrgContext,
  filters?: FormulationStatsFilters,
): Promise<FormulationStats> {
  requireOrgScope(ctx);
  const [stats] = await db.select({ totalFormulations: count() })
    .from(formulations)
    .where(and(
      eq(formulations.organizationId, ctx.organizationId),
      filters?.archived ? isNotNull(formulations.archivedAt) : isNull(formulations.archivedAt),
    ));
  return { totalFormulations: Number(stats.totalFormulations) };
}
