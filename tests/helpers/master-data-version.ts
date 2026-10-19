import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, reactors, storageLocations, suppliers, supplierLocations, customers, customerLocations, formulations, feedstockTypes } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";

const tables = { facilities, reactors, storageLocations, suppliers, supplierLocations, customers, customerLocations, formulations, feedstockTypes };
const INITIAL_VERSION = 1;

/** Load a fresh precondition for regression tests exercising other write guards. */
export async function masterDataVersion(ctx: OrgContext, entity: keyof typeof tables, id: string): Promise<number> {
  const table = tables[entity];
  const [row] = await db.select({ version: table.version }).from(table)
    .where(and(eq(table.id, id), eq(table.organizationId, ctx.organizationId)));
  // Missing/foreign-row tests must still reach the writer's own scoped refusal.
  return row?.version ?? INITIAL_VERSION;
}
