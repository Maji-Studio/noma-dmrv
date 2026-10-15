import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { getSequestrationInputBinding, hasExplicitSequestrationBinding } from "./sequestration-input-bindings";
import type { components } from "./generated/certify";
import { ownValue } from "./semantic-binding-catalog";
import { isSequestrationBlueprintFamily } from "./storage-blueprints";
import { lookupInputMapping, lookupPeriodInputTuple, resolveDatapointSource } from "./datapoint-mapping";
import { effectiveContract, validateLineSources, type LineSources } from "./template-observations/line-sources";
import { normalizeTemplateDefinition } from "./template-observations/normalize";

const TRANSPORT_BLUEPRINT_KEY = "transport";

export interface UnbindableTemplateInput {
  groupKey: string;
  componentId: string;
  componentDisplayName: string;
  blueprintKey: string;
  inputKey: string;
  takenComponentNames?: string[];
  reason: "unmapped" | "ambiguous" | "project-scope" | "unrecognized-component" | "unassigned";
}

/** Contracts own source identity. Entry-only period lines keep the sandbox stub policy until PR 4. */
export function findUnbindableTemplateInputs(
  template: components["schemas"]["GhgEntryTemplate"],
  options: { allowPeriodInputStub?: boolean; lineSources?: LineSources } = {},
): UnbindableTemplateInput[] {
  const lineSources = options.lineSources ?? {};
  const problems = validateLineSources(normalizeTemplateDefinition(template), lineSources);
  const findings: UnbindableTemplateInput[] = [];
  for (const group of template.groups) {
    for (const component of group.components) {
      const stored = ownValue(lineSources, component.id);
      const contract = stored && effectiveContract(stored);
      const componentProblems = problems.filter((problem) => problem.componentId === component.id);
      for (const input of component.inputs) {
        const target: UnbindableTemplateInput = {
          groupKey: group.key, componentId: component.id, componentDisplayName: component.display_name,
          blueprintKey: component.blueprint_key, inputKey: input.input_key, reason: "unmapped",
        };
        if (!contract || contract.scope === "unassigned") { findings.push({ ...target, reason: "unassigned" }); break; }
        if (contract.scope === "forbidden") { findings.push({ ...target, inputKey: component.inputs.find((candidate) => candidate.type === "monitored")?.input_key ?? input.input_key, reason: "project-scope" }); break; }
        if (componentProblems.some((problem) => problem.code === "ambiguous")) { findings.push({ ...target, reason: "ambiguous" }); break; }
        if (componentProblems.length) { findings.push({ ...target, reason: "unassigned" }); break; }
        if (isSequestrationBlueprintFamily(component.blueprint_key)) {
          if (hasExplicitSequestrationBinding(component.blueprint_key) && !getSequestrationInputBinding(component.blueprint_key, input.input_key)) findings.push(target);
          continue;
        }
        if (input.type === "fixed") continue;
        if (lookupPeriodInputTuple(group.key, component.blueprint_key, input.input_key, contract)) {
          if (!options.allowPeriodInputStub) findings.push({ ...target, reason: "project-scope" });
          continue;
        }
        const mapping = lookupInputMapping(group.key, component.blueprint_key, input.input_key, contract);
        if (!mapping) {
          if (component.blueprint_key !== TRANSPORT_BLUEPRINT_KEY || !findings.some((finding) => finding.componentId === component.id)) findings.push(target);
          continue;
        }
        try { resolveDatapointSource(mapping, contract); }
        catch { findings.push({ ...target, reason: "unassigned" }); }
      }
      // Empty lines also require a contract.
      if (component.inputs.length === 0 && (!contract || contract.scope === "unassigned")) findings.push({
        groupKey: group.key, componentId: component.id, componentDisplayName: component.display_name,
        blueprintKey: component.blueprint_key, inputKey: "", reason: "unassigned",
      });
    }
  }
  return findings;
}

function listNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function formatInstruction(input: UnbindableTemplateInput, count = 1): string {
  const plural = count > 1;
  const target = plural ? "each one" : "it";
  if (input.reason === "unassigned") return REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview;
  if (input.reason === "project-scope" || input.reason === "unrecognized-component") {
    return `Add ${target} as a project component in Isometric, then remove ${plural ? "them" : "it"} from the Removal template.`;
  }
  if (input.reason === "ambiguous") return `${REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview} Choose a different automatic source for each line.`;
  if (input.blueprintKey === TRANSPORT_BLUEPRINT_KEY) return `Replace ${target} with a Mass-distance-based CI emissions component in Isometric, or pick another Removal template.`;
  return "Pick another Removal template or ask support to add the mapping.";
}

export function formatUnbindableTemplateInputs(inputs: readonly UnbindableTemplateInput[]): { lead: string; lines: string[] } {
  if (!inputs.length) return { lead: "", lines: [] };
  const components = new Map(inputs.map((input) => [input.componentId, input]));
  const reasons = new Map<string, UnbindableTemplateInput[]>();
  for (const input of components.values()) {
    const instruction = formatInstruction(input);
    reasons.set(instruction, [...(reasons.get(instruction) ?? []), input]);
  }
  return {
    lead: `The Removal template has ${components.size} ${components.size === 1 ? "component" : "components"} noma cannot submit.`,
    lines: [...reasons.values()].map((matches) => `${listNames(matches.map((input) => input.componentDisplayName))}: ${formatInstruction(matches[0], matches.length)}`),
  };
}

export function formatUnbindableTemplateInputsText(inputs: readonly UnbindableTemplateInput[]): string {
  const { lead, lines } = formatUnbindableTemplateInputs(inputs);
  return [lead, ...lines].join("\n");
}
