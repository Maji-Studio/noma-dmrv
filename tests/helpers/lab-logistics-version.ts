import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { samples, orders, deliveries, transportLegs, applications, creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";

const tables = { samples, orders, deliveries, transportLegs, applications, creditBatches };
const INITIAL_VERSION = 1;

/** Existing regression fixtures load a precondition before exercising other guards. */
export async function labLogisticsVersion(ctx: OrgContext, entity: keyof typeof tables, id: string): Promise<number> {
  const table = tables[entity];
  const [row] = await db.select({ version: table.version }).from(table)
    .where(and(eq(table.id, id), eq(table.organizationId, ctx.organizationId)));
  return row?.version ?? INITIAL_VERSION;
}
