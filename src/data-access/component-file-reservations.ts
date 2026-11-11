import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

/** Load all reservation owners together, retaining unknown owners as locked. */
export async function loadComponentFileReservations(ctx: OrgContext, submissionIds: string[]) {
  requireOrgScope(ctx);
  if (!submissionIds.length) return [];
  return db.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId),
    inArray(certificationSubmissions.id, [...new Set(submissionIds)]),
  ));
}
