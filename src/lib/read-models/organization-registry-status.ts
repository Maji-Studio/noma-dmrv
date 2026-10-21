import { env } from "@/config/env";
import { hasCertifierCredentials } from "@/data-access/certifier-credentials";
import type { OrgContext } from "@/lib/auth/server";
import { ISOMETRIC_PROVIDER } from "@/lib/isometric/utils/constants";

/**
 * What the settings console needs to know about the organization's registry
 * before any pane mounts: whether keys are saved (the panes that need keys hide
 * until then) and which Isometric environment writes land in.
 */
export interface OrganizationRegistryStatus {
  keysSaved: boolean;
  isProduction: boolean;
}

export async function readOrganizationRegistryStatus(
  ctx: OrgContext,
): Promise<OrganizationRegistryStatus> {
  return {
    keysSaved: await hasCertifierCredentials(ctx, ISOMETRIC_PROVIDER),
    isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
  };
}
