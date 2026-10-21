import { getOrganizationApiAccess } from "@/data-access/organization-api-access";
import { requireOrgScope } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";

/**
 * Whether API keys and connected apps may act for the active organization.
 * A Platform Admin switch; the organization only reads it.
 */
export async function readOrganizationApiAccess(ctx: OrgContext): Promise<boolean> {
  requireOrgScope(ctx);
  return getOrganizationApiAccess(ctx.organizationId);
}
