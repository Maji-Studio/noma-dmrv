import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationApiAccess, organizations } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/auth/server";

// org-scope-ok: credential resolver checks the credential's organization before constructing an OrgContext.
export async function getOrganizationApiAccess(organizationId: string): Promise<boolean> {
  const [row] = await db.select({ enabled: organizationApiAccess.enabled })
    .from(organizationApiAccess).where(eq(organizationApiAccess.organizationId, organizationId));
  return row?.enabled ?? true;
}

// org-scope-ok: Platform Admins explicitly administer API access across organizations.
export async function setOrganizationApiAccess(organizationId: string, enabled: boolean): Promise<void> {
  const admin = await requirePlatformAdmin();
  await db.insert(organizationApiAccess).values({ organizationId, enabled, changedByUserId: admin.id })
    .onConflictDoUpdate({
      target: organizationApiAccess.organizationId,
      set: { enabled, changedByUserId: admin.id, changedAt: new Date() },
    });
}

// org-scope-ok: Platform Admin directory deliberately reads API access across all organizations.
export async function listOrganizationApiAccess() {
  await requirePlatformAdmin();
  const rows = await db
    .select({ organizationId: organizations.id, enabled: organizationApiAccess.enabled })
    .from(organizations)
    .leftJoin(organizationApiAccess, eq(organizationApiAccess.organizationId, organizations.id));
  return rows.map((row) => ({ ...row, enabled: row.enabled ?? true }));
}
