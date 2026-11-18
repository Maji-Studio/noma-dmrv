import { FILE_POLICIES } from "../src/lib/isometric/template-observations/file-policies";
import { z } from "zod";
import { lookupBindingTriple } from "../src/lib/isometric/semantic-binding-projections";
import { INPUT_MAPPING, lookupPeriodInputTuple } from "../src/lib/isometric/datapoint-mapping";
import { TRANSPORT_BLUEPRINT_KEY } from "../src/lib/isometric/emission-line-constants";
import {
  findUnbindableTemplateInputs,
  type UnbindableTemplateInput,
} from "../src/lib/isometric/template-binding-coverage";
import {
  AUTOMATIC_SOURCE_IDS,
  allowedEntryPolicies,
  normalizeTemplateDefinition,
  resolveLineSources,
  type GhgEntryTemplate,
  type LineSources,
  type TemplateDefinition,
} from "../src/lib/isometric/template-observations";

const reviewedLineSourceSchema = z.strictObject({
  scope: z.enum(["operating", "forbidden", "unassigned"]),
  automaticSource: z.enum(AUTOMATIC_SOURCE_IDS).optional(),
  entryPolicy: z.enum(["none", "single", "additive"]),
  filePolicy: z.enum(FILE_POLICIES).optional(),
});

// Fail fixture typos before making registry requests.
export const coverageFixtureSchema = z.object({
  facilities: z.array(z.object({
    label: z.string().min(1),
    externalProjectId: z.string().min(1),
    removalTemplateId: z.string().min(1),
    reviewedLineSources: z.record(z.string().min(1), reviewedLineSourceSchema).optional(),
  })).min(1),
});

export type FacilityFixtureEntry = z.infer<typeof coverageFixtureSchema>["facilities"][number];

/** Overlay explicit fixture reviews, preserving proposals for every other line. */
export function resolveCoverageLineSources(
  template: GhgEntryTemplate,
  reviewedLineSources: FacilityFixtureEntry["reviewedLineSources"] = {},
): LineSources {
  const definition = normalizeTemplateDefinition(template);
  const componentIds = new Set(definition.groups.flatMap((group) => group.components.map((component) => component.id)));
  const unknownIds = Object.keys(reviewedLineSources).filter((id) => !componentIds.has(id));
  if (unknownIds.length) {
    throw new Error(`Reviewed line sources for template ${template.id} contain unknown component IDs: ${unknownIds.join(", ")}`);
  }
  return {
    ...resolveLineSources({ definition }),
    ...Object.fromEntries(Object.entries(reviewedLineSources).map(([id, contract]) => [id, { ...contract, origin: "reviewed" as const }])),
  };
}

function hasKnownComponentShape(definition: TemplateDefinition, lineSources: LineSources, finding: UnbindableTemplateInput): boolean {
  const { groupKey, componentId, blueprintKey } = finding;
  if (blueprintKey === TRANSPORT_BLUEPRINT_KEY) return false;
  const component = definition.groups.find((group) => group.key === groupKey)
    ?.components.find((component) => component.id === componentId);
  if (!component) return false;
  // Shared entry policies cover supported entry-only shapes, including operating hours.
  // Also retain stable catalog shapes for retired automatic sample sources: runtime
  // lookup intentionally hides those sources, but entries still support their inputs.
  const contract = lineSources[componentId];
  if (contract && contract.entryPolicy !== "none" && allowedEntryPolicies(component).includes(contract.entryPolicy)) return true;
  return component.inputs.filter((input) => input.type === "monitored").every((input) =>
    lookupBindingTriple(INPUT_MAPPING, groupKey, blueprintKey, input.key) ||
    lookupPeriodInputTuple(groupKey, blueprintKey, input.key),
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
    if (finding.state === "empty" && hasKnownComponentShape(definition, lineSources, finding)) {
      // Warn once per component, even when it has several monitored inputs.
      entryOnly.set(finding.componentId, finding);
    } else {
      failures.push(finding);
    }
  }
  return { failures, entryOnly: [...entryOnly.values()] };
}
