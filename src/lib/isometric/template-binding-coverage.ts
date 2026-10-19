import { LINE_NO_MAPPING_MESSAGE, LINE_TRANSPORT_REPLACEMENT_MESSAGE, TRANSPORT_BLUEPRINT_KEY } from "./emission-line-constants";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { emissionLineBindingDecision, type EmissionLineBindingDecision, type LineCoverageReason } from "@/lib/certification/emission-line-binding";
import type { components } from "./generated/certify";
import { ownValue } from "./semantic-binding-catalog";
import { validateLineSources, type LineSources } from "./template-observations/line-sources";
import { normalizeTemplateDefinition } from "./template-observations/normalize";

export interface UnbindableTemplateInput {
  state: EmissionLineBindingDecision["state"];
  groupKey: string;
  componentId: string;
  componentDisplayName: string;
  blueprintKey: string;
  inputKey: string;
  takenComponentNames?: string[];
  reason: LineCoverageReason;
}

export function findUnbindableTemplateInputs(
  template: components["schemas"]["GhgEntryTemplate"],
  options: { lineSources?: LineSources; enrichmentComplete?: boolean } = {},
): UnbindableTemplateInput[] {
  if (options.enrichmentComplete === false) return [];
  const definition = normalizeTemplateDefinition(template);
  const lineSources = options.lineSources ?? {};
  const problems = validateLineSources(definition, lineSources);
  const componentsById = new Map(definition.groups.flatMap((group) => group.components.map((component) => [component.id, component] as const)));
  return template.groups.flatMap((group) => group.components.flatMap((rawComponent) => {
    const component = componentsById.get(rawComponent.id)!;
    const decision = emissionLineBindingDecision({ component, groupKey: group.key,
      contract: ownValue(lineSources, component.id), problems, enrichmentComplete: options.enrichmentComplete ?? true });
    if (!decision) return [];
    const finding = (inputKey: string, reason: LineCoverageReason) => ({ groupKey: group.key, componentId: component.id,
      componentDisplayName: component.displayName, blueprintKey: component.blueprintKey, inputKey, reason, state: decision.state });
    return [
      ...(decision.unknownInputKeys ?? []).map((inputKey) => finding(inputKey, "unmapped")),
      ...decision.inputKeys.map((inputKey) => finding(inputKey, decision.reason)),
    ];
  }));
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
  if (input.blueprintKey === TRANSPORT_BLUEPRINT_KEY) return LINE_TRANSPORT_REPLACEMENT_MESSAGE.replace("Replace it", `Replace ${target}`);
  return LINE_NO_MAPPING_MESSAGE;
}

export function formatUnbindableTemplateInputs(inputs: readonly UnbindableTemplateInput[]): { lead: string; lines: string[] } {
  if (!inputs.length) return { lead: "", lines: [] };
  const components = new Map(inputs.map((input) => [input.componentId, input]));
  const reasons = new Map<string, UnbindableTemplateInput[]>();
  for (const input of inputs) {
    const instruction = formatInstruction(input);
    reasons.set(instruction, [...(reasons.get(instruction) ?? []), input]);
  }
  return {
    lead: `The Removal template has ${components.size} ${components.size === 1 ? "component" : "components"} noma cannot submit.`,
    lines: [...reasons.values()].map((matches) => {
      const byComponent = new Map<string, UnbindableTemplateInput[]>();
      for (const input of matches) byComponent.set(input.componentId, [...(byComponent.get(input.componentId) ?? []), input]);
      const names = [...byComponent.values()].map((inputs) => {
        const first = inputs[0];
        const keys = [...new Set(inputs.map((input) => input.inputKey))].sort();
        return `${first.componentDisplayName} (${first.componentId}; blueprint ${first.blueprintKey}; ${keys.length === 1 ? "input" : "inputs"} ${keys.join(", ")})`;
      });
      return `${listNames(names)}: ${formatInstruction(matches[0], byComponent.size)}`;
    }),
  };
}

export function formatUnbindableTemplateInputsText(inputs: readonly UnbindableTemplateInput[]): string {
  const { lead, lines } = formatUnbindableTemplateInputs(inputs);
  return [lead, ...lines].join("\n");
}
