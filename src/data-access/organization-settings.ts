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
import { db } from "@/db";
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
): Promise<OrganizationDefaults> {
  requireOrgScope(ctx);
  const [row] = await db
    .select({
      defaultCurrency: organizationSettings.defaultCurrency,
      defaultCountry: organizationSettings.defaultCountry,
      defaultTimezone: organizationSettings.defaultTimezone,
      defaultTripType: organizationSettings.defaultTripType,
      defaultEvidenceMethod: organizationSettings.defaultEvidenceMethod,
      defaultPackaging: organizationSettings.defaultPackaging,
    })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, ctx.organizationId))
    .limit(1);

  if (!row) return DEFAULT_ORGANIZATION_SETTINGS;

  return {
    // The column is free text (ISO 4217) to match `orders.currency`, so it is
    // narrowed here rather than by the database.
    defaultCurrency:
      row.defaultCurrency as OrganizationDefaults["defaultCurrency"],
    defaultCountry: row.defaultCountry,
    defaultTimezone: row.defaultTimezone,
    defaultTripType: row.defaultTripType,
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
      defaultCurrency: organizationSettings.defaultCurrency,
      defaultCountry: organizationSettings.defaultCountry,
      defaultTimezone: organizationSettings.defaultTimezone,
      defaultTripType: organizationSettings.defaultTripType,
      defaultEvidenceMethod: organizationSettings.defaultEvidenceMethod,
      defaultPackaging: organizationSettings.defaultPackaging,
    });

  if (!row) {
    throw new SafeError("Operating defaults were not saved.");
  }

  return {
    defaultCurrency:
      row.defaultCurrency as OrganizationDefaults["defaultCurrency"],
    defaultCountry: row.defaultCountry,
    defaultTimezone: row.defaultTimezone,
    defaultTripType: row.defaultTripType,
    defaultEvidenceMethod: row.defaultEvidenceMethod,
    defaultPackaging: row.defaultPackaging,
  };
}
