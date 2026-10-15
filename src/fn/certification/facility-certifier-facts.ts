import type { OrgContext } from "@/lib/auth/server";
import { hasCertifierCredentials, resolveIsometricClient } from "@/data-access/certifier-credentials";
import { getCertifierProjectByFacility, type CertifierProjectRow } from "@/data-access/certification";
import { listPinnedRemovalTemplateIds } from "@/data-access/credit-batch-removal-template";
import { listComponentBlueprints, listProjects, listGhgEntryTemplates, type IsometricComponentBlueprint, type IsometricProject, type IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { UnbindableTemplateInput } from "@/lib/isometric/template-binding-coverage";
import { ISOMETRIC_PROVIDER, safeListIfConfigured } from "./shared";
import type { TransportCategory } from "./certify-transport-coverage";
import { loadRemovalTemplateFacts, type RemovalTemplateFacts } from "./removal-template-facts";

export interface FacilityCertifierFacts {
  hasOrgCredentials: boolean;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  /** Settings and diagnostics only. Removal compilation resolves batch pins. */
  defaultTemplate: IsometricGhgEntryTemplate | null;
  missingDefaultTemplateId: string | null;
  removalTemplateIds: string[];
  /** Only templates the registry still lists; a pinned id may be absent. */
  templatesById: Partial<Record<string, RemovalTemplateFacts>>;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  unbindableTemplateInputs: UnbindableTemplateInput[];
  requiredTransportCategories: TransportCategory[];
}

const UNRESOLVED_FACILITY_FACTS = {
  defaultTemplate: null, missingDefaultTemplateId: null, removalTemplateIds: [], templatesById: {},
  blueprintsForTemplate: [], unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransportCategories: [],
};

export async function loadFacilityCertifierFacts(orgCtx: OrgContext, facilityId: string, options: { refreshEnrichment?: boolean } = {}): Promise<FacilityCertifierFacts> {
  const [mapping, hasOrgCredentials] = await Promise.all([
    getCertifierProjectByFacility(orgCtx, facilityId, ISOMETRIC_PROVIDER),
    hasCertifierCredentials(orgCtx, ISOMETRIC_PROVIDER),
  ]);
  if (!mapping || !hasOrgCredentials) return { hasOrgCredentials, mapping, project: null, ...UNRESOLVED_FACILITY_FACTS };
  const pinnedIds = await listPinnedRemovalTemplateIds(orgCtx, facilityId);
  // Avoid a remote registry dependency until a template id exists to resolve.
  if (!mapping.defaultRemovalTemplateId && pinnedIds.length === 0) {
    return { hasOrgCredentials, mapping, project: null, ...UNRESOLVED_FACILITY_FACTS };
  }
  const client = await resolveIsometricClient(orgCtx);
  const [projects, templates, blueprints] = await Promise.all([
    safeListIfConfigured(() => listProjects(client)),
    safeListIfConfigured(() => listGhgEntryTemplates(client, mapping.externalProjectId)),
    safeListIfConfigured(() => listComponentBlueprints(client)),
  ]);
  const ids = new Set([mapping.defaultRemovalTemplateId, ...pinnedIds]);
  // Keep observation transactions ordered to limit pool pressure.
  const templatesById: Record<string, RemovalTemplateFacts> = {};
  for (const template of templates.filter((template) => ids.has(template.id))) {
    templatesById[template.id] = await loadRemovalTemplateFacts(orgCtx, { client, externalProjectId: mapping.externalProjectId, template, blueprints, ...options });
  }
  const defaultFacts = mapping.defaultRemovalTemplateId ? templatesById[mapping.defaultRemovalTemplateId] : null;
  return {
    hasOrgCredentials, mapping, project: projects.find((project) => project.id === mapping.externalProjectId) ?? null,
    defaultTemplate: defaultFacts?.template ?? null,
    missingDefaultTemplateId: defaultFacts ? null : mapping.defaultRemovalTemplateId,
    templatesById,
    removalTemplateIds: [...ids].filter((id): id is string => !!id),
    blueprintsForTemplate: defaultFacts?.blueprintsForTemplate ?? [],
    unresolvedBlueprintKeys: defaultFacts?.unresolvedBlueprintKeys ?? [],
    unbindableTemplateInputs: defaultFacts?.unbindableTemplateInputs ?? [],
    requiredTransportCategories: defaultFacts?.requiredTransportCategories ?? [],
  };
}
