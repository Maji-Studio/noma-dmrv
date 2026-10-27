import type { components } from "../generated/certify";
import { isSequestrationBlueprintFamily } from "../storage-blueprints";

export type ComponentType = components["schemas"]["ComponentType"];
export type TemplateLineSection = "mitigated" | "emitted";

export function templateLineSection(
  blueprintType: ComponentType | null | undefined,
  blueprintKey: string,
): TemplateLineSection {
  if (blueprintType) {
    return blueprintType === "SEQUESTRATION" || blueprintType === "REDUCTION" ? "mitigated" : "emitted";
  }
  return isSequestrationBlueprintFamily(blueprintKey) ? "mitigated" : "emitted";
}
