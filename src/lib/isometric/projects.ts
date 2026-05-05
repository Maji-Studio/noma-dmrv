import { paginateAll } from "./client";
import type { components } from "./generated/certify";

export type IsometricProject = components["schemas"]["Project"];
export type IsometricRemovalTemplate = components["schemas"]["RemovalTemplate"];

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
