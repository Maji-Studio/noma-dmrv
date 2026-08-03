"use server";

/**
 * Organization operating defaults. Any member reads them — their forms are
 * seeded from these values — and only Owners/Admins write.
 */
import {
  getOrganizationDefaults,
  upsertOrganizationDefaults,
  type OrganizationDefaults,
} from "@/data-access/organization-settings";
import { organizationSettingsFormSchema } from "@/schemas/organization-settings";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

export interface OrganizationDefaultsPayload {
  defaults: OrganizationDefaults;
  /** Server-computed. Never gate the write on this alone — the action re-checks. */
  viewerCanManage: boolean;
}

export async function loadOrganizationDefaults(): Promise<
  ActionResult<OrganizationDefaultsPayload>
> {
  return withAction(async (ctx) => ({
    defaults: await getOrganizationDefaults(ctx),
    viewerCanManage:
      ctx.isPlatformAdmin ||
      ctx.orgRole === "owner" ||
      ctx.orgRole === "admin",
  }));
}

export async function saveOrganizationDefaults(
  input: unknown,
): Promise<ActionResult<OrganizationDefaults>> {
  return withAction(async (ctx) => {
    const values = organizationSettingsFormSchema.parse(input);
    // The role floor lives in data-access, next to the write it guards.
    return upsertOrganizationDefaults(ctx, values);
  });
}
