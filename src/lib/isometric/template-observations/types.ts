import type { components } from "../generated/certify";

export type GhgEntryTemplate = components["schemas"]["GhgEntryTemplate"];
export type QuantityKind = components["schemas"]["QuantityKindType"];

export interface TemplateInput {
  key: string;
  type: "fixed" | "monitored";
  quantityKind: QuantityKind;
  fixedDatapointId?: string;
}

export interface TemplateComponent {
  id: string;
  displayName: string;
  description: string | null;
  blueprintKey: string;
  inputs: TemplateInput[];
}

export interface TemplateGroup {
  id: string;
  key: string;
  displayName: string;
  description: string;
  components: TemplateComponent[];
}

export interface TemplateDefinition {
  groups: TemplateGroup[];
}

/** Monitored inputs have a unit from the blueprint, but no fixed value. */
export type InputEnrichment =
  | { unit: string; fixedValue?: string | number | null; deprecated?: boolean | null }
  | { status: "unknown" };
export type ComponentEnrichment = Record<string, InputEnrichment>;
export type TemplateEnrichment = Record<string, ComponentEnrichment>;
export type EntryPolicy = "none" | "additive" | "single";

export interface TemplateObservation {
  definition: TemplateDefinition;
  enrichment: TemplateEnrichment;
}

/** A line's entry-relevant contract, independent of the template around it. */
export interface EntryLine {
  component: TemplateComponent;
  enrichment: ComponentEnrichment;
  entryPolicy: EntryPolicy;
}
