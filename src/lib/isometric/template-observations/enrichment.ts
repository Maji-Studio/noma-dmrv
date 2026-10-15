import { ownValue } from "../semantic-binding-catalog";
import { canonicalDecimal, canonicalUnit } from "./units";
import type { InputEnrichment, TemplateDefinition, TemplateEnrichment, TemplateInput } from "./types";

export interface EnrichmentProblem {
  code: "unknown-enrichment" | "unknown-unit" | "missing-fixed-value" | "missing-fixed-datapoint";
  componentId: string;
  inputKey: string;
}

export function inputEnrichment(enrichment: TemplateEnrichment, componentId: string, inputKey: string): InputEnrichment | undefined {
  const component = ownValue(enrichment, componentId);
  return component && ownValue(component, inputKey);
}

export function normalizedEnrichment(input: TemplateInput, enriched: InputEnrichment | undefined) {
  if (!enriched || "status" in enriched) return { status: "unknown" } as const;
  return {
    unit: canonicalUnit(input.quantityKind, enriched.unit) ?? enriched.unit,
    ...(input.type === "fixed" ? { fixedValue: enriched.fixedValue == null ? null : canonicalDecimal(enriched.fixedValue) ?? String(enriched.fixedValue) } : {}),
  };
}

/** Deprecation is advisory and does not make an otherwise complete read fail. */
export function enrichmentProblems(definition: TemplateDefinition, enrichment: TemplateEnrichment): EnrichmentProblem[] {
  const problems: EnrichmentProblem[] = [];
  for (const group of definition.groups) {
    for (const component of group.components) {
      for (const input of component.inputs) {
        const ref = { componentId: component.id, inputKey: input.key };
        const enriched = inputEnrichment(enrichment, component.id, input.key);
        if (input.type === "fixed" && !input.fixedDatapointId) problems.push({ ...ref, code: "missing-fixed-datapoint" });
        if (!enriched || "status" in enriched) {
          problems.push({ ...ref, code: "unknown-enrichment" });
          continue;
        }
        if (!canonicalUnit(input.quantityKind, enriched.unit)) problems.push({ ...ref, code: "unknown-unit" });
        if (input.type === "fixed" && (enriched.fixedValue == null || canonicalDecimal(enriched.fixedValue) === undefined)) {
          problems.push({ ...ref, code: "missing-fixed-value" });
        }
      }
    }
  }
  return problems;
}

export function isEnrichmentComplete(definition: TemplateDefinition, enrichment: TemplateEnrichment): boolean {
  return enrichmentProblems(definition, enrichment).length === 0;
}
