/**
 * Organization operating defaults — read and upsert.
 *
 * The read never returns null. An organization with no row gets
 * `DEFAULT_ORGANIZATION_SETTINGS`, so every consumer sees one shape and nobody
 * has to decide what "no settings row" means at the call site. Only writes
 * require the Owner/Admin floor; any member may read, because these are form
 * defaults that every member's forms need.
 */
import { eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { organizationSettings } from "@/db/schema/settings";
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  type OrganizationDefaults,
} from "@/config/organization-settings";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

export type { OrganizationDefaults };

export async function getOrganizationDefaults(
  ctx: OrgContext,
  executor: Pick<DbTransaction, "select"> = db,
): Promise<OrganizationDefaults> {
  requireOrgScope(ctx);
  const [row] = await executor
    .select({
      defaultCountry: organizationSettings.defaultCountry,
      defaultTimezone: organizationSettings.defaultTimezone,
      defaultEvidenceMethod: organizationSettings.defaultEvidenceMethod,
      defaultPackaging: organizationSettings.defaultPackaging,
    })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, ctx.organizationId))
    .limit(1);

  if (!row) return { ...DEFAULT_ORGANIZATION_SETTINGS };

  return {
    defaultCountry: row.defaultCountry,
    defaultTimezone: row.defaultTimezone,
    defaultEvidenceMethod: row.defaultEvidenceMethod,
    defaultPackaging: row.defaultPackaging,
  };
}

export async function upsertOrganizationDefaults(
  ctx: OrgContext,
  input: OrganizationDefaults,
): Promise<OrganizationDefaults> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");

  const [row] = await db
    .insert(organizationSettings)
    .values({ organizationId: ctx.organizationId, ...input })
    .onConflictDoUpdate({
      target: organizationSettings.organizationId,
      set: { ...input, updatedAt: new Date() },
    })
    .returning({
      defaultCountry: organizationSettings.defaultCountry,
      defaultTimezone: organizationSettings.defaultTimezone,
      defaultEvidenceMethod: organizationSettings.defaultEvidenceMethod,
      defaultPackaging: organizationSettings.defaultPackaging,
    });

  if (!row) {
    throw new SafeError("Operating defaults were not saved.");
  }

  return {
    defaultCountry: row.defaultCountry,
    defaultTimezone: row.defaultTimezone,
    defaultEvidenceMethod: row.defaultEvidenceMethod,
    defaultPackaging: row.defaultPackaging,
  };
}
