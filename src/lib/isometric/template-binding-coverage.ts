import { getSequestrationInputBinding, hasExplicitSequestrationBinding } from "./sequestration-input-bindings";
import type { components } from "./generated/certify";
import { lookupSourceFact } from "./semantic-binding-catalog";
import { isSequestrationBlueprintFamily } from "./storage-blueprints";
import {
  componentRenameGuidance,
  lookupInputMapping,
  lookupPeriodInputTuple,
  resolveDatapointSource,
} from "./datapoint-mapping";

const TRANSPORT_BLUEPRINT_KEY = "transport";

export interface UnbindableTemplateInput {
  groupKey: string;
  componentId: string;
  componentDisplayName: string;
  blueprintKey: string;
  inputKey: string;
  takenComponentNames?: string[];
  reason: "unmapped" | "ambiguous" | "project-scope" | "unrecognized-component";
}

function aggregateKey(input: UnbindableTemplateInput): string {
  const mapping = lookupInputMapping(input.groupKey, input.blueprintKey, input.inputKey);
  const source = mapping && resolveDatapointSource(mapping, input.componentDisplayName);
  return JSON.stringify([input.blueprintKey, input.inputKey, source]);
}

/** Mirrors resolveTemplateInputs and the datapoint builder's mapping precedence.
 * Storage inputs use the shared sequestration bindings; project-scope inputs follow the sandbox
 * stub policy. Coverage includes production inputs a later claim can omit.
 */
export function findUnbindableTemplateInputs(
  template: components["schemas"]["GhgEntryTemplate"],
  options: { allowPeriodInputStub?: boolean } = {},
): UnbindableTemplateInput[] {
  const findings: UnbindableTemplateInput[] = [];
  const components = template.groups.flatMap((group) => group.components);
  const aggregates = new Map<string, UnbindableTemplateInput[]>();
  for (const group of template.groups) {
    for (const component of group.components) {
      for (const input of component.inputs) {
        const target: UnbindableTemplateInput = {
          groupKey: group.key,
          componentId: component.id,
          componentDisplayName: component.display_name,
          blueprintKey: component.blueprint_key,
          inputKey: input.input_key,
          takenComponentNames: components.filter((other) => other.id !== component.id).map((other) => other.display_name),
          reason: "unmapped",
        };
        if (isSequestrationBlueprintFamily(component.blueprint_key)) {
          // Unbound storage blueprints retain their existing tier/durability guidance.
          if (
            hasExplicitSequestrationBinding(component.blueprint_key) &&
            !getSequestrationInputBinding(component.blueprint_key, input.input_key)
          ) findings.push(target);
          continue;
        }
        if (input.type === "fixed") continue;
        if (lookupPeriodInputTuple(group.key, component.blueprint_key, input.input_key, component.display_name)) {
          if (!options.allowPeriodInputStub) findings.push({ ...target, reason: "project-scope" });
          continue;
        }
        const mapping = lookupInputMapping(group.key, component.blueprint_key, input.input_key);
        if (!mapping) {
          if (component.blueprint_key !== TRANSPORT_BLUEPRINT_KEY || !findings.some((finding) => finding.componentId === component.id)) {
            findings.push(target);
          }
          continue;
        }
        let key: string;
        try {
          key = aggregateKey(target);
        } catch {
          findings.push({ ...target, reason: "unrecognized-component" });
          continue;
        }
        const matches = aggregates.get(key) ?? [];
        matches.push({ ...target, reason: "ambiguous" });
        aggregates.set(key, matches);
      }
    }
  }
  for (const matches of aggregates.values()) {
    if (new Set(matches.map((input) => input.componentId)).size > 1) findings.push(...matches);
  }
  return findings;
}

function listNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function formatInstruction(input: UnbindableTemplateInput, count = 1): string {
  const plural = count > 1;
  const mapping = lookupInputMapping(input.groupKey, input.blueprintKey, input.inputKey);
  const target = plural ? "each one" : "it";
  if (input.reason === "unrecognized-component" || (input.reason === "project-scope" && mapping?.sourceByComponent)) {
    const guidance = mapping && componentRenameGuidance(mapping, { count, takenNames: input.takenComponentNames });
    if (guidance) {
      const context = input.reason === "project-scope"
        ? `${plural ? "These components can" : "This component can"} stay on the Removal only under ${plural ? "their expected names" : "its expected name"}. `
        : "";
      return `${context}${guidance}`;
    }
  }
  if (input.reason === "project-scope" || input.reason === "unrecognized-component") {
    return `Add ${target} as a project component in Isometric, then remove ${plural ? "them" : "it"} from the Removal template.`;
  }
  if (input.reason === "ambiguous") {
    const source = mapping && resolveDatapointSource(mapping, input.componentDisplayName);
    const provenance = source ? lookupSourceFact(source)?.provenance.toLowerCase() : undefined;
    return `receive the same ${provenance ?? "calculated"} total. Keep one of them in the Removal template, or ask support to split them.`;
  }
  if (input.blueprintKey === TRANSPORT_BLUEPRINT_KEY) {
    return `Replace ${target} with a Mass-distance-based CI emissions component in Isometric, or pick another Removal template.`;
  }
  return "Pick another Removal template or ask support to add the mapping.";
}

/** Shared operator copy with one lead and a list of reason instructions. */
export function formatUnbindableTemplateInputs(inputs: readonly UnbindableTemplateInput[]): { lead: string; lines: string[] } {
  if (inputs.length === 0) return { lead: "", lines: [] };
  const components = new Map<string, UnbindableTemplateInput>();
  // Prefer rename guidance over other findings for the same component.
  for (const input of inputs) {
    const mapping = lookupInputMapping(input.groupKey, input.blueprintKey, input.inputKey);
    if (!components.has(input.componentId) || mapping?.sourceByComponent) components.set(input.componentId, input);
  }
  const reasons = new Map<string, UnbindableTemplateInput[]>();
  for (const input of components.values()) {
    const instruction = formatInstruction(input);
    reasons.set(instruction, [...(reasons.get(instruction) ?? []), input]);
  }
  const lead = `The Removal template has ${components.size} ${components.size === 1 ? "component" : "components"} noma cannot submit.`;
  const lines: string[] = [];
  for (const matches of reasons.values()) {
    const instruction = formatInstruction(matches[0], matches.length);
    const names = listNames(matches.map((input) => input.componentDisplayName));
    lines.push(matches[0].reason === "ambiguous"
      ? `${names} would ${matches.length > 2 ? "all" : "both"} ${instruction}`
      : `${names}: ${instruction}`);
  }
  return { lead, lines };
}

/** Plain-text variant for thrown errors and readiness/blocker messages. */
export function formatUnbindableTemplateInputsText(inputs: readonly UnbindableTemplateInput[]): string {
  const { lead, lines } = formatUnbindableTemplateInputs(inputs);
  return [lead, ...lines].join("\n");
}
