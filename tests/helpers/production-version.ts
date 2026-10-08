import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, productionSamples, incidentReports, biocharProducts } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";

/** Existing regression fixtures load the command precondition before editing. */
export async function productionVersion(ctx: OrgContext, entity: "productionRuns" | "productionSamples" | "incidentReports" | "biocharProducts", id: string): Promise<number> {
  const table = { productionRuns, productionSamples, incidentReports, biocharProducts }[entity];
  const [row] = await db.select({ version: table.version }).from(table)
    .where(and(eq(table.id, id), eq(table.organizationId, ctx.organizationId)));
  if (!row) throw new Error(`Missing production fixture ${id}`);
  return row.version;
}
