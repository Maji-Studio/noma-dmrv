import { logger } from "@/lib/log";
import type { IsometricClient } from "./client";
import type { components } from "./generated/certify";

const log = logger.child({ mod: "isometric" });

export type IsometricProject = components["schemas"]["Project"];
export type IsometricGhgEntryTemplate =
  components["schemas"]["GhgEntryTemplate"];
export type IsometricComponentBlueprint =
  components["schemas"]["ComponentBlueprint"];
export type IsometricComponent = components["schemas"]["Component"];
export type IsometricComponentScope = components["schemas"]["ComponentScope"];

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

// Lists Components attached to a Project / GHG Statement / GHG Entry, filtered
// by scope. Used by the Posture B drift panel and the nightly coverage check
// (ADR 0005) to reconcile `PROJECT`-scope Components — Isometric has no
// `GET /projects/{id}` endpoint and the `Project` schema carries no
// components field, so `GET /components?project_id=…&scope=PROJECT` is the
// only path. `Component.scope` and the `ComponentScope` enum
// (`REMOVAL | GHG_STATEMENT | PROJECT | NET_NEGATIVITY`) are stable across
// the surface; default omitted = unfiltered.
export interface ListComponentsArgs {
  projectId?: string;
  scope?: IsometricComponentScope;
  ghgStatementId?: string;
  ghgEntryId?: string;
  supplierReferenceId?: string;
}

export function listComponents(
  client: IsometricClient,
  args: ListComponentsArgs = {},
): Promise<IsometricComponent[]> {
  return client.paginateAll<IsometricComponent>("/components", {
    query: {
      project_id: args.projectId,
      scope: args.scope,
      ghg_statement_id: args.ghgStatementId,
      ghg_entry_id: args.ghgEntryId,
      supplier_reference_id: args.supplierReferenceId,
    },
  });
}
