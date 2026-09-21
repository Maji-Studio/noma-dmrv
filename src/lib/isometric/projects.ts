import { logger } from "@/lib/log";
import type { IsometricClient } from "./client";
import type { components } from "./generated/certify";

const log = logger.child({ mod: "isometric" });

export type IsometricProject = components["schemas"]["Project"];
export type IsometricGhgEntryTemplate =
  components["schemas"]["GhgEntryTemplate"];
export type IsometricComponentBlueprint =
  components["schemas"]["ComponentBlueprint"];

export function listProjects(client: IsometricClient): Promise<IsometricProject[]> {
  return client.paginateAll<IsometricProject>("/projects");
}

export async function listGhgEntryTemplates(
  client: IsometricClient,
  externalProjectId: string,
): Promise<IsometricGhgEntryTemplate[]> {
  const templates = await client.paginateAll<IsometricGhgEntryTemplate>(
    `/projects/${encodeURIComponent(externalProjectId)}/ghg_entry_templates`,
  );
  // We only produce biochar REMOVAL credits. The renamed GHG-entry surface
  // generalizes templates over REDUCTION credits too; flag any non-REMOVAL
  // template so a mis-bound project surfaces here rather than at submit time.
  for (const template of templates) {
    if (template.credit_type !== "REMOVAL") {
      log.warn(
        { externalProjectId, templateId: template.id, creditType: template.credit_type },
        "ghg_entry_template is not REMOVAL credit_type",
      );
    }
  }
  return templates;
}

export function listComponentBlueprints(client: IsometricClient): Promise<IsometricComponentBlueprint[]> {
  return client.paginateAll<IsometricComponentBlueprint>("/component_blueprints");
}
