import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonical-json";
import { inputEnrichment, normalizedEnrichment } from "./enrichment";
import { compareIds } from "./normalize";
import type { TemplateComponent, TemplateDefinition, TemplateEnrichment } from "./types";

export function fingerprintComponent(component: TemplateComponent, enrichment: TemplateEnrichment, full: boolean) {
  return {
    id: component.id,
    blueprintKey: component.blueprintKey,
    ...(full ? { displayName: component.displayName, description: component.description } : {}),
    inputs: [...component.inputs].sort((a, b) => compareIds(a.key, b.key)).map((input) => ({
      ...input,
      enrichment: normalizedEnrichment(input, inputEnrichment(enrichment, component.id, input.key)),
    })),
  };
}

function fingerprint(definition: TemplateDefinition, enrichment: TemplateEnrichment, full: boolean): string {
  const value = {
    groups: [...definition.groups].sort((a, b) => compareIds(a.id, b.id)).map((group) => ({
      id: group.id,
      key: group.key,
      ...(full ? { displayName: group.displayName, description: group.description } : {}),
      components: [...group.components].sort((a, b) => compareIds(a.id, b.id)).map((component) => fingerprintComponent(component, enrichment, full)),
    })),
  };
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function semanticFingerprint(definition: TemplateDefinition, enrichment: TemplateEnrichment): string {
  return fingerprint(definition, enrichment, false);
}

export function fullFingerprint(definition: TemplateDefinition, enrichment: TemplateEnrichment): string {
  return fingerprint(definition, enrichment, true);
}
