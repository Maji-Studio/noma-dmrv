import { paginateAll } from "./client";
import type { components } from "./generated/certify";

export type IsometricProject = components["schemas"]["Project"];
export type IsometricRemovalTemplate = components["schemas"]["RemovalTemplate"];
export type IsometricComponentBlueprint =
  components["schemas"]["ComponentBlueprint"];
export type IsometricComponent = components["schemas"]["Component"];
export type IsometricComponentScope = components["schemas"]["ComponentScope"];

export function listProjects(): Promise<IsometricProject[]> {
  return paginateAll<IsometricProject>("/projects");
}

export function listRemovalTemplates(
  externalProjectId: string,
): Promise<IsometricRemovalTemplate[]> {
  return paginateAll<IsometricRemovalTemplate>(
    `/projects/${encodeURIComponent(externalProjectId)}/removal_templates`,
  );
}

export function listComponentBlueprints(): Promise<IsometricComponentBlueprint[]> {
  return paginateAll<IsometricComponentBlueprint>("/component_blueprints");
}

// Lists Components attached to a Project / GHG Statement / Removal, filtered
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
  removalId?: string;
  supplierReferenceId?: string;
}

export function listComponents(
  args: ListComponentsArgs = {},
): Promise<IsometricComponent[]> {
  return paginateAll<IsometricComponent>("/components", {
    query: {
      project_id: args.projectId,
      scope: args.scope,
      ghg_statement_id: args.ghgStatementId,
      removal_id: args.removalId,
      supplier_reference_id: args.supplierReferenceId,
    },
  });
}
