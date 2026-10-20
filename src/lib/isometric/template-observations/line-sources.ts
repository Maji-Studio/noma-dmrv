import { ownValue } from "../semantic-binding-catalog";
import { BOOTSTRAP_LINE_SOURCES } from "./bootstrap";
import { automaticSourceAvailable, catalogCandidates, hasCatalogDisambiguation, type AutomaticSourceId } from "./catalog-sources";
import { allowedEntryPolicies, isLegacyAutomaticPair } from "./entry-policies";
import type { EntryPolicy, TemplateDefinition } from "./types";

export interface LineContract {
  scope: "operating" | "forbidden" | "unassigned";
  automaticSource?: AutomaticSourceId;
  entryPolicy: EntryPolicy;
  origin: "bootstrap" | "carried" | "reviewed" | "proposed";
  /** Display metadata from raw template arrays, excluded from entry compatibility. */
  templateOrder?: { groupPosition: number; position: number };
}
export type LineSources = Record<string, LineContract>;
export interface LineSourceProblem {
  code: "single-with-automatic-source" | "foreign-automatic-source" | "retired-automatic-source" | "disallowed-entry-policy" | "ambiguous" | "missing-contract" | "unassigned";
  componentId: string;
}

/** Assignment is a repair step, not an editor for settled contracts. */
export function lineNeedsReview(componentId: string, contract: LineContract | undefined, problems: readonly LineSourceProblem[]): boolean {
  return !contract || contract.origin === "proposed" || contract.scope === "unassigned" ||
    problems.some((problem) => problem.componentId === componentId);
}

/** Proposals must be reviewed before they grant any contribution capability. */
export function effectiveContract(contract: LineContract): LineContract {
  return contract.origin === "proposed" || contract.scope === "unassigned"
    ? { scope: "unassigned", entryPolicy: "none", origin: contract.origin }
    : { ...contract, ...(contract.automaticSource && !automaticSourceAvailable(contract.automaticSource) ? { automaticSource: undefined } : {}) };
}

export function validateLineSources(definition: TemplateDefinition, lineSources: LineSources, options: { entriesEnabled?: boolean } = {}): LineSourceProblem[] {
  const problems: LineSourceProblem[] = [];
  const sourceOwners = new Map<AutomaticSourceId, string[]>();
  for (const group of definition.groups) {
    for (const component of group.components) {
      const componentId = component.id;
      const contract = ownValue(lineSources, componentId);
      if (!contract) {
        problems.push({ code: "missing-contract", componentId });
        continue;
      }
      if (effectiveContract(contract).scope === "unassigned") problems.push({ code: "unassigned", componentId });
      if (contract.entryPolicy === "single" && contract.automaticSource) problems.push({ code: "single-with-automatic-source", componentId });
      if (!allowedEntryPolicies(component).includes(contract.entryPolicy) &&
        !(options.entriesEnabled === false && isLegacyAutomaticPair(component, contract))) problems.push({ code: "disallowed-entry-policy", componentId });
      if (contract.automaticSource && !automaticSourceAvailable(contract.automaticSource) && contract.entryPolicy === "none") {
        problems.push({ code: "retired-automatic-source", componentId });
      }
      if (contract.automaticSource && automaticSourceAvailable(contract.automaticSource)) {
        if (!catalogCandidates(component, group.key).includes(contract.automaticSource)) problems.push({ code: "foreign-automatic-source", componentId });
        const owners = sourceOwners.get(contract.automaticSource) ?? [];
        sourceOwners.set(contract.automaticSource, [...owners, componentId]);
      }
    }
  }
  for (const owners of sourceOwners.values()) {
    if (new Set(owners).size > 1) problems.push(...owners.map((componentId) => ({ code: "ambiguous" as const, componentId })));
  }
  return problems;
}

/**
 * The one check for whether a pending proposal can be accepted as is; the
 * Accept proposal control and any bulk accept use it. Accepting every
 * acceptable proposal together adds no problem: collisions are reported on
 * every owner of a figure, including pending proposals, so no two acceptable
 * proposals share one. The save still checks the whole template, so it also
 * needs every other line free of problems.
 */
export function isAcceptableProposal(definition: TemplateDefinition, lineSources: LineSources, componentId: string): boolean {
  const contract = ownValue(lineSources, componentId);
  if (!contract || contract.origin !== "proposed" || contract.scope === "unassigned") return false;
  if (!definition.groups.some((group) => group.components.some((component) => component.id === componentId))) return false;
  const accepted: LineSources = { ...lineSources, [componentId]: { ...contract, origin: "reviewed" } };
  return !validateLineSources(definition, accepted).some((problem) => problem.componentId === componentId && problem.code !== "unassigned");
}

export function normalizeStoredLineSources(definition: TemplateDefinition, lineSources: LineSources): LineSources {
  const components = new Map(definition.groups.flatMap((group) => group.components.map((component) => [component.id, component] as const)));
  return Object.fromEntries(Object.entries(lineSources).map(([id, contract]) => {
    const component = components.get(id);
    return [id, component && (contract.origin === "bootstrap" || contract.origin === "proposed") && isLegacyAutomaticPair(component, contract)
      ? { ...contract, entryPolicy: "none" } : { ...contract }];
  }));
}

export function withoutUnacceptableProposals(definition: TemplateDefinition, lineSources: LineSources): LineSources {
  lineSources = normalizeStoredLineSources(definition, lineSources);
  // noma has no precedence rule between lines sharing a figure: none is proposed
  // it and the operator decides. Every proposal noma makes can be accepted and
  // saved as is. Check the input snapshot before applying any replacements.
  return Object.fromEntries(Object.entries(lineSources).map(([id, contract]): [string, LineContract] => [id,
    contract.origin === "proposed" && contract.scope !== "unassigned" && !isAcceptableProposal(definition, lineSources, id)
      ? { scope: "unassigned", entryPolicy: "none", origin: "proposed",
        ...(contract.templateOrder ? { templateOrder: contract.templateOrder } : {}),
      }
      : { ...contract },
  ]));
}

export function resolveLineSources({ definition, previous }: {
  definition: TemplateDefinition;
  previous?: { definition: TemplateDefinition; lineSources: LineSources };
}): LineSources {
  const previousIds = new Set(previous?.definition.groups.flatMap((group) => group.components.map((component) => component.id)));
  const previousSources = previous && normalizeStoredLineSources(definition, previous.lineSources);
  const sources: LineSources = {};
  for (const group of definition.groups) {
    for (const component of group.components) {
      const carried = previousIds.has(component.id) && previousSources && ownValue(previousSources, component.id);
      // A pending proposal stays pending across repeated observations. Changing
      // its origin to carried would accept it on the next live read. An empty
      // proposal is not carried: a figure dropped for a clash is proposed again
      // once the clash is gone, and the final pass still filters it.
      // Keep reviewed legacy pairs reviewed so later observations cannot normalize the decision.
      if (carried && !(carried.origin === "proposed" && carried.scope === "unassigned")) {
        sources[component.id] = { ...carried, origin: carried.origin === "proposed" || (carried.origin === "reviewed" && isLegacyAutomaticPair(component, carried)) ? carried.origin : "carried" };
        continue;
      }
      const bootstrap = ownValue(BOOTSTRAP_LINE_SOURCES, component.id);
      if (bootstrap) {
        const automaticSingle = bootstrap.automaticSource && allowedEntryPolicies(component).includes("single") &&
          catalogCandidates(component, group.key).includes(bootstrap.automaticSource);
        sources[component.id] = { ...bootstrap,
          entryPolicy: automaticSingle ? "none" : bootstrap.entryPolicy,
          origin: "bootstrap" };
        continue;
      }
      const candidates = catalogCandidates(component, group.key);
      if (candidates.length === 1 && !hasCatalogDisambiguation(component.blueprintKey)) {
        const entryPolicy = allowedEntryPolicies(component).includes("additive") ? "additive" : "none";
        sources[component.id] = { scope: "operating", automaticSource: candidates[0], entryPolicy, origin: "proposed" };
      } else {
        sources[component.id] = { scope: "unassigned", entryPolicy: "none", origin: "proposed" };
      }
    }
  }
  return withoutUnacceptableProposals(definition, sources);
}
