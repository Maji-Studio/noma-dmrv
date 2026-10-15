import type { OrgContext } from "@/lib/auth/server";
import { env } from "@/config/env";
import { hasCertifierCredentials, resolveIsometricClient } from "@/data-access/certifier-credentials";
import { getCertifierProjectByFacility, type CertifierProjectRow } from "@/data-access/certification";
import { listComponentBlueprints, listProjects, listGhgEntryTemplates, type IsometricComponentBlueprint, type IsometricProject, type IsometricGhgEntryTemplate } from "@/lib/isometric";
import { allowsPeriodInputStub } from "@/lib/isometric/datapoint-mapping";
import { findUnbindableTemplateInputs, type UnbindableTemplateInput } from "@/lib/isometric/template-binding-coverage";
import { hasExplicitSequestrationBinding } from "@/lib/isometric/transformers/sequestration-binding";
import { ISOMETRIC_PROVIDER, safeListIfConfigured } from "./shared";
import { deriveRequiredTransportCategories, type TransportCategory } from "./certify-transport-coverage";

// The facility-scoped half of a removal's submission context: the Isometric
// mapping + (when it resolves cleanly) the project / default template /
// referenced component blueprints, and the transport categories that template
// requires. These depend only on the facility, so the Overview work queue
// resolves them ONCE and feeds them to every removal's `buildRemovalContext`
// instead of re-pulling the same template/blueprint data per row.
export interface FacilityCertifierFacts {
  hasOrgCredentials: boolean;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  defaultTemplate: IsometricGhgEntryTemplate | null;
  missingDefaultTemplateId: string | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  unbindableTemplateInputs: UnbindableTemplateInput[];
  requiredTransportCategories: TransportCategory[];
}

// Template-dependent fields shared by each unresolved short-circuit.
const UNRESOLVED_FACILITY_FACTS: Omit<
  FacilityCertifierFacts,
  "hasOrgCredentials" | "mapping" | "project"
> = {
  defaultTemplate: null,
  missingDefaultTemplateId: null,
  blueprintsForTemplate: [],
  unresolvedBlueprintKeys: [],
  unbindableTemplateInputs: [],
  requiredTransportCategories: [],
};

// Resolves the mapping, credentials, remote project/template, and referenced
// blueprints once per facility. Unresolved prerequisites skip downstream calls.
export async function loadFacilityCertifierFacts(
  orgCtx: OrgContext,
  facilityId: string,
): Promise<FacilityCertifierFacts> {
  const [mapping, hasOrgCredentials] = await Promise.all([
    getCertifierProjectByFacility(orgCtx, facilityId, ISOMETRIC_PROVIDER),
    hasCertifierCredentials(orgCtx, ISOMETRIC_PROVIDER),
  ]);
  if (!mapping) {
    return { hasOrgCredentials, mapping: null, project: null, ...UNRESOLVED_FACILITY_FACTS };
  }
  if (!hasOrgCredentials) {
    return { hasOrgCredentials: false, mapping, project: null, ...UNRESOLVED_FACILITY_FACTS };
  }
  // Avoid remote registry dependency until a template id exists to resolve.
  if (!mapping.defaultRemovalTemplateId) {
    return {
      hasOrgCredentials,
      mapping,
      project: null,
      ...UNRESOLVED_FACILITY_FACTS,
    };
  }

  const client = await resolveIsometricClient(orgCtx);

  const [projects, templates] = await Promise.all([
    safeListIfConfigured(() => listProjects(client)),
    safeListIfConfigured(() => listGhgEntryTemplates(client, mapping.externalProjectId)),
  ]);
  const project =
    projects.find((p) => p.id === mapping.externalProjectId) ?? null;

  const defaultTemplate =
    templates.find((t) => t.id === mapping.defaultRemovalTemplateId) ?? null;
  if (!defaultTemplate) {
    return {
      hasOrgCredentials,
      mapping,
      project,
      ...UNRESOLVED_FACILITY_FACTS,
      missingDefaultTemplateId: mapping.defaultRemovalTemplateId,
    };
  }

  const referencedKeys = Array.from(
    new Set(
      defaultTemplate.groups.flatMap((group) =>
        group.components.map((component) => component.blueprint_key),
      ),
    ),
  );
  const allBlueprints = await safeListIfConfigured(() =>
    listComponentBlueprints(client),
  );
  const blueprintByKey = new Map(allBlueprints.map((bp) => [bp.key, bp]));
  const blueprintsForTemplate: IsometricComponentBlueprint[] = [];
  const unresolvedBlueprintKeys: string[] = [];
  for (const key of referencedKeys) {
    const found = blueprintByKey.get(key);
    if (found) blueprintsForTemplate.push(found);
    // Explicit bindings are the fail-closed source of truth for template
    // components intentionally absent from the global blueprint catalogue.
    else if (!hasExplicitSequestrationBinding(key)) {
      unresolvedBlueprintKeys.push(key);
    }
  }

  return {
    hasOrgCredentials,
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId: null,
    blueprintsForTemplate,
    unresolvedBlueprintKeys,
    unbindableTemplateInputs: findUnbindableTemplateInputs(defaultTemplate, { allowPeriodInputStub: allowsPeriodInputStub(env.ISOMETRIC_ENVIRONMENT) }),
    requiredTransportCategories:
      deriveRequiredTransportCategories(defaultTemplate),
  };
}

