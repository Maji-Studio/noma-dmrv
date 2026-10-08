import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationApiAccess } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";

// org-scope-ok: credential resolver checks the credential's organization before constructing an OrgContext.
export async function getOrganizationApiAccess(organizationId: string): Promise<boolean> {
  const [row] = await db.select({ enabled: organizationApiAccess.enabled })
    .from(organizationApiAccess).where(eq(organizationApiAccess.organizationId, organizationId));
  return row?.enabled ?? true;
}

// org-scope-ok: Platform Admins explicitly administer API access across organizations.
export async function setOrganizationApiAccess(ctx: OrgContext, organizationId: string, enabled: boolean): Promise<void> {
  if (!ctx.isPlatformAdmin) throw new DomainError("forbidden", "Only Platform Admins can change API access.");
  await db.insert(organizationApiAccess).values({ organizationId, enabled, changedByUserId: ctx.userId })
    .onConflictDoUpdate({
      target: organizationApiAccess.organizationId,
      set: { enabled, changedByUserId: ctx.userId, changedAt: new Date() },
    });
}
