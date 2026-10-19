import { lookupInputMapping, lookupPeriodInputTuple } from "../src/lib/isometric/datapoint-mapping";
import { TRANSPORT_BLUEPRINT_KEY } from "../src/lib/isometric/emission-line-constants";
import {
  findUnbindableTemplateInputs,
  type UnbindableTemplateInput,
} from "../src/lib/isometric/template-binding-coverage";
import {
  normalizeTemplateDefinition,
  resolveLineSources,
  type GhgEntryTemplate,
  type LineSources,
} from "../src/lib/isometric/template-observations";

function hasKnownComponentShape(template: GhgEntryTemplate, finding: UnbindableTemplateInput): boolean {
  const { groupKey, componentId, blueprintKey } = finding;
  if (blueprintKey === TRANSPORT_BLUEPRINT_KEY) return false;
  const component = template.groups.find((group) => group.key === groupKey)
    ?.components.find((component) => component.id === componentId);
  if (!component) return false;
  // Omit contracts: entry-only lines still need a catalog triple for every monitored input.
  return component.inputs.filter((input) => input.type === "monitored").every((input) =>
    lookupInputMapping(groupKey, blueprintKey, input.input_key) ||
    lookupPeriodInputTuple(groupKey, blueprintKey, input.input_key),
  );
}

/** Check template contracts, without requiring batch-specific emissions entries. */
export function evaluateTemplateCoverage(
  template: GhgEntryTemplate,
  options: { lineSources?: LineSources } = {},
): { failures: UnbindableTemplateInput[]; entryOnly: UnbindableTemplateInput[] } {
  const definition = normalizeTemplateDefinition(template);
  const lineSources = options.lineSources ?? resolveLineSources({ definition });
  // The shared coverage function validates contracts and decides every component.
  const findings = findUnbindableTemplateInputs(template, { lineSources });
  const failures: UnbindableTemplateInput[] = [];
  const entryOnly = new Map<string, UnbindableTemplateInput>();
  for (const finding of findings) {
    if (finding.state === "empty" && hasKnownComponentShape(template, finding)) {
      // Warn once per component, even when it has several monitored inputs.
      entryOnly.set(finding.componentId, finding);
    } else {
      failures.push(finding);
    }
  }
  return { failures, entryOnly: [...entryOnly.values()] };
}
