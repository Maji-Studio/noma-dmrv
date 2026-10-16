import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, transportLegs } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

/** Numeric columns use mode:number elsewhere; cast before the driver decodes them. */
export async function getEmissionAutomaticMasses(ctx: OrgContext, runIds: string[], legIds: string[]) {
  requireOrgScope(ctx);
  const [runs, legs] = await Promise.all([
    runIds.length
      ? db
          .select({
            id: productionRuns.id,
            feedstockMassDryKg: sql<string | null>`${productionRuns.feedstockMassDryKg}::text`,
            biocharDryMassKg: sql<string | null>`${productionRuns.biocharDryMassKg}::text`,
          })
          .from(productionRuns)
          .where(
            and(eq(productionRuns.organizationId, ctx.organizationId), inArray(productionRuns.id, runIds)),
          )
      : [],
    legIds.length
      ? db
          .select({ id: transportLegs.id, loadMassKg: sql<string | null>`${transportLegs.loadMassKg}::text` })
          .from(transportLegs)
          .where(and(eq(transportLegs.organizationId, ctx.organizationId), inArray(transportLegs.id, legIds)))
      : [],
  ]);
  return {
    runs: Object.fromEntries(runs.map((run) => [run.id, run])),
    legs: Object.fromEntries(legs.map((leg) => [leg.id, leg.loadMassKg])),
  };
}
