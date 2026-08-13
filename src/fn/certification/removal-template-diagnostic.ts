"use server";

import { env } from "@/config/env";
import { requireOrgFacility } from "@/data-access/utils";
import { requireAdminAction } from "@/lib/auth/server";
import {
  buildRemovalTemplateDiagnostic,
  type RemovalTemplateDiagnosticModel,
} from "@/lib/certification/removal-template-diagnostic";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadFacilityCertifierFacts } from "./certify-context-core";
import { z } from "zod";

const facilityIdSchema = z.uuid("Choose a valid facility.");

export type RemovalTemplateDiagnosticAvailability =
  | "ready"
  | "project-not-linked"
  | "credentials-not-configured"
  | "template-not-selected"
  | "template-not-found";

export interface RemovalTemplateDiagnosticData {
  environment: "sandbox" | "production";
  availability: RemovalTemplateDiagnosticAvailability;
  project: {
    linked: boolean;
    resolved: boolean;
    id: string | null;
    name: string | null;
  };
  selectedTemplateId: string | null;
  diagnostic: RemovalTemplateDiagnosticModel | null;
}

/**
 * Platform-only, read-only loader for the active facility Removal template.
 * The returned model contains identifiers and contract metadata, but never
 * credentials, secret values, or operator identity fields.
 */
export async function loadRemovalTemplateDiagnostic(
  facilityId: string,
): Promise<ActionResult<RemovalTemplateDiagnosticData>> {
  return withAction(async (orgCtx) => {
    await requireAdminAction();
    const parsedFacilityId = facilityIdSchema.parse(facilityId);
    await requireOrgFacility(orgCtx, parsedFacilityId);
    const facts = await loadFacilityCertifierFacts(orgCtx, parsedFacilityId);
    const selectedTemplateId = facts.mapping?.defaultRemovalTemplateId ?? null;

    let availability: RemovalTemplateDiagnosticAvailability = "ready";
    if (!facts.mapping) availability = "project-not-linked";
    else if (!facts.hasOrgCredentials) availability = "credentials-not-configured";
    else if (!selectedTemplateId) availability = "template-not-selected";
    else if (!facts.defaultTemplate) availability = "template-not-found";

    return {
      environment: env.ISOMETRIC_ENVIRONMENT,
      availability,
      project: {
        linked: Boolean(facts.mapping),
        resolved: Boolean(facts.project),
        id: facts.mapping?.externalProjectId ?? null,
        name: facts.project?.name ?? null,
      },
      selectedTemplateId,
      diagnostic: facts.defaultTemplate
        ? buildRemovalTemplateDiagnostic({
            template: facts.defaultTemplate,
            blueprints: facts.blueprintsForTemplate,
          })
        : null,
    };
  });
}
