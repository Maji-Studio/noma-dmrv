import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { facilities, organizations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope } from "./utils";

export async function getApiMeOrganization(ctx: OrgContext) {
  requireOrgScope(ctx);
  const [organization] = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  if (!organization) throw new DomainError("not_found", "Organization not found.");
  const accessibleFacilities = await db.select({
    id: facilities.id, code: facilities.code, name: facilities.name, timeZone: facilities.timezone,
  }).from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)))
    .orderBy(facilities.code, facilities.id);
  return { organization, facilities: accessibleFacilities };
}
