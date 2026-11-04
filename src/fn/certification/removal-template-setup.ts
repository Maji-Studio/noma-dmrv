"use server";

import { applyRemovalTemplateSetupCore, loadRemovalTemplateSetupCore } from "./removal-template-setup-core";
import { applyRemovalTemplateSetupSchema, loadRemovalTemplateSetupSchema, type ApplyRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";
import { requireOrgRole } from "@/lib/auth/server";
import { withAction } from "../with-action";

export async function loadRemovalTemplateSetup(facilityId: string) {
  return withAction(async (ctx) => loadRemovalTemplateSetupCore(ctx, loadRemovalTemplateSetupSchema.parse(facilityId)));
}

export async function applyRemovalTemplateSetup(input: ApplyRemovalTemplateSetupInput) {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    return applyRemovalTemplateSetupCore(ctx, applyRemovalTemplateSetupSchema.parse(input));
  });
}
