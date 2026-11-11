import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

export async function getCreditBatchCodes(ctx: OrgContext, facilityId: string, ids: string[]) {
  requireOrgScope(ctx);
  return db.select({ id: creditBatches.id, code: creditBatches.code }).from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId),
    inArray(creditBatches.id, ids),
  ));
}
