"use server";

import { getCertifierProjectByFacility, updateFacilityDefaultRemovalTemplate, type CertifierProjectRow } from "@/data-access/certification";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { SafeError } from "@/lib/errors";
import { listComponentBlueprints, listGhgEntryTemplates } from "@/lib/isometric";
import { assertSequestrationTemplateSelectable } from "@/lib/isometric/transformers/sequestration-binding";
import {
  setFacilityDefaultRemovalTemplateSchema, startRemovalTemplateSetupSchema,
  type SetFacilityDefaultRemovalTemplateInput, type StartRemovalTemplateSetupInput,
} from "@/schemas/removal-template-setup";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { ISOMETRIC_PROVIDER } from "./shared";

async function loadSetupTarget(ctx: OrgContext, input: StartRemovalTemplateSetupInput) {
  await requireOrgFacility(ctx, input.facilityId);
  const mapping = await getCertifierProjectByFacility(ctx, input.facilityId, ISOMETRIC_PROVIDER);
  if (!mapping) throw new SafeError("Link this facility to an Isometric project first.");
  const client = await resolveIsometricClient(ctx);
  const templates = await listGhgEntryTemplates(client, mapping.externalProjectId);
  const template = templates.find((candidate) => candidate.id === input.removalTemplateId);
  if (!template) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFound);
  if (template.credit_type !== "REMOVAL") throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.notRemovalTemplate);
  assertSequestrationTemplateSelectable(template);
  return { client, template, externalProjectId: mapping.externalProjectId };
}

export async function setFacilityDefaultRemovalTemplate(
  input: SetFacilityDefaultRemovalTemplateInput,
): Promise<ActionResult<CertifierProjectRow>> {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    const parsed = setFacilityDefaultRemovalTemplateSchema.parse(input);
    const target = await loadSetupTarget(ctx, parsed);
    await loadRemovalTemplateFacts(ctx, { ...target, blueprints: await listComponentBlueprints(target.client) });
    return updateFacilityDefaultRemovalTemplate(ctx, { ...parsed, externalProjectId: target.externalProjectId });
  });
}

export async function startRemovalTemplateSetup(input: StartRemovalTemplateSetupInput): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    const parsed = startRemovalTemplateSetupSchema.parse(input);
    const target = await loadSetupTarget(ctx, parsed);
    const facts = await loadRemovalTemplateFacts(ctx, { ...target, blueprints: await listComponentBlueprints(target.client) });
    if (!facts.observation) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
  });
}
