import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { classifySequestration1000YearComponent } from "./storage-blueprints";

export interface SequestrationSelectionTemplate {
  groups: readonly { components: readonly { blueprint_key: string }[] }[];
}

/**
 * Configuration-time guard for newly selected templates. Historical snapshots
 * remain readable, but operators cannot bind a deprecated or unsupported
 * Method-B 1,000-year component as the facility default.
 */
export function sequestrationTemplateSelectionError(template: SequestrationSelectionTemplate): string | null {
  for (const component of template.groups.flatMap((group) => group.components)) {
    const classification = classifySequestration1000YearComponent(
      component.blueprint_key,
    );
    if (classification === "deprecated" || classification === "unsupported-unsampled") {
      return REMOVAL_TEMPLATE_BLOCKERS.unsupportedSequestration;
    }
  }
  return null;
}
