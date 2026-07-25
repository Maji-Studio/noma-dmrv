"use server";

import {
  getRegistrySourceVisibility,
  upsertRegistrySourceVisibility,
  type RegistrySourceVisibility,
} from "@/data-access/certifier-organization-settings";
import { requireOrgRole } from "@/lib/auth/server";
import {
  registrySourceVisibilitySchema,
  type RegistrySourceVisibilityInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { ISOMETRIC_PROVIDER } from "./shared";

export interface RegistrySourceVisibilitySettings {
  sourceVisibility: RegistrySourceVisibility;
  viewerCanManage: boolean;
}

export async function loadRegistrySourceVisibility(): Promise<
  ActionResult<RegistrySourceVisibilitySettings>
> {
  return withAction(async (orgCtx) => ({
    sourceVisibility: await getRegistrySourceVisibility(
      orgCtx,
      ISOMETRIC_PROVIDER,
    ),
    viewerCanManage:
      orgCtx.isPlatformAdmin ||
      orgCtx.orgRole === "owner" ||
      orgCtx.orgRole === "admin",
  }));
}

export async function saveRegistrySourceVisibility(
  input: RegistrySourceVisibilityInput,
): Promise<ActionResult<{ sourceVisibility: RegistrySourceVisibility }>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = registrySourceVisibilitySchema.parse(input);
    const sourceVisibility = await upsertRegistrySourceVisibility(orgCtx, {
      provider: ISOMETRIC_PROVIDER,
      sourceVisibility: parsed.sourceVisibility,
    });
    return { sourceVisibility };
  });
}
