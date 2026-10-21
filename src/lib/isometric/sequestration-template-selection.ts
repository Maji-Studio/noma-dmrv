import { SafeError } from "@/lib/errors";
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
    if (classification === "deprecated") {
      return "The selected template uses the legacy 1,000-year component with total-carbon and uncapped durability semantics. Select a template using biochar_sequestration_1000_year_f_durable_max.";
    }
    if (classification === "unsupported-unsampled") {
      return "The selected template uses the unsampled 1,000-year component. Unsampled Method B is not supported; select the sampled 1,000-year template.";
    }
  }
  return null;
}

export function assertSequestrationTemplateSelectable(template: SequestrationSelectionTemplate): void {
  const error = sequestrationTemplateSelectionError(template);
  if (error) throw new SafeError(error);
}
