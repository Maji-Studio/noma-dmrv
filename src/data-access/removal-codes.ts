import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { certifierRemovals } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

export async function getRemovalCodes(ctx: OrgContext, ids: string[]) {
  requireOrgScope(ctx);
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: certifierRemovals.id, code: certifierRemovals.code })
    .from(certifierRemovals).where(and(inArray(certifierRemovals.id, ids), eq(certifierRemovals.organizationId, ctx.organizationId)));
  return new Map(rows.map(row => [row.id, row.code]));
}
