import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { SafeError } from "@/lib/errors";
import { expectedSequestrationBlueprintKeys, isSequestrationBlueprintFamily, isStorageBlueprintKey, type DurabilityTier } from "@/lib/isometric/storage-blueprints";
import { assertSequestrationTemplateSelectable } from "@/lib/isometric/transformers/sequestration-binding";
import { catalogCandidates, hasCatalogDisambiguation, type AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";
import { allowedEntryPolicies } from "@/lib/isometric/template-observations/entry-policies";
import { isAcceptableProposal, lineNeedsReview, type LineContract, type LineSources, type LineSourceProblem } from "@/lib/isometric/template-observations/line-sources";
import type { TemplateComponent, TemplateDefinition } from "@/lib/isometric/template-observations";
import { SOURCE_LABELS } from "./removal-template-source-labels";

export type SetupAssignment = Pick<LineContract, "scope" | "automaticSource" | "entryPolicy">;
export interface SetupOption { id: string; label: string; assignments: Record<string, SetupAssignment> }
export interface SetupComponent { component: TemplateComponent; groupKey: string; contract: LineContract | undefined }
export interface SetupDefault extends SetupComponent { proposal: SetupOption; options: SetupOption[] }
export interface SetupDecision { id: string; kind: "clash" | "source" | "added"; components: SetupComponent[]; options: SetupOption[] }
export interface RemovalTemplateSetupPlan { decided: SetupComponent[]; defaults: SetupDefault[]; decisions: SetupDecision[] }

export function templateFitsFacility(template: IsometricGhgEntryTemplate, durabilityOption: DurabilityTier | null): { fits: true } | { reason: string } {
  if (template.credit_type !== "REMOVAL") return { reason: "This is not a Removal template." };
  try { assertSequestrationTemplateSelectable(template); }
  catch (error) { if (error instanceof SafeError) return { reason: "This template uses an unsupported storage component." }; throw error; }
  const keys = template.groups.flatMap((group) => group.components.map((component) => component.blueprint_key));
  if (!keys.some(isStorageBlueprintKey)) return { reason: "This template has no storage component." };
  if (durabilityOption && keys.some((key) => isSequestrationBlueprintFamily(key) && !expectedSequestrationBlueprintKeys(durabilityOption).has(key))) {
    return { reason: "The storage component does not match this facility's durability tier." };
  }
  return { fits: true };
}

function componentOptions(line: SetupComponent): SetupOption[] {
  const { component, groupKey } = line;
  const entryPolicy = allowedEntryPolicies(component).find((policy) => policy !== "none") ?? "none";
  const options: SetupOption[] = catalogCandidates(component, groupKey).map((source) => ({
    id: source, label: source,
    assignments: { [component.id]: { scope: "operating", automaticSource: source, entryPolicy: entryPolicy === "single" ? "none" : entryPolicy } },
  }));
  options.push({ id: "entry", label: options.length ? "Neither, entry" : "Entry", assignments: { [component.id]: { scope: "operating", entryPolicy } } });
  return options;
}

/** Each component appears once. A clash is one joint choice, preventing duplicate source assignments. */
export function setupPlan(definition: TemplateDefinition, lineSources: LineSources, problems: readonly LineSourceProblem[]): RemovalTemplateSetupPlan {
  const plan: RemovalTemplateSetupPlan = { decided: [], defaults: [], decisions: [] };
  const pending: SetupComponent[] = [];
  for (const group of definition.groups) for (const component of group.components) {
    const line = { component, groupKey: group.key, contract: lineSources[component.id] };
    (lineNeedsReview(component.id, line.contract, problems) ? pending : plan.decided).push(line);
  }
  const hasReviewed = Object.values(lineSources).some((line) => line.origin === "reviewed" || line.origin === "carried");
  const usedSources = new Set(plan.decided.flatMap((line) => line.contract?.automaticSource ?? []));
  const availableCandidates = (line: SetupComponent) =>
    catalogCandidates(line.component, line.groupKey).filter((source) => !usedSources.has(source));
  const consumed = new Set<string>();
  for (const line of pending) {
    const id = line.component.id;
    if (consumed.has(id)) continue;
    const candidates = availableCandidates(line);
    const competitors = candidates.length === 1 ? pending.filter((other) => {
      const sources = availableCandidates(other);
      return sources.length === 1 && sources[0] === candidates[0];
    }) : [];
    if (competitors.length > 1) {
      competitors.forEach((other) => consumed.add(other.component.id));
      plan.decisions.push({ id: `clash:${candidates[0]}`, kind: "clash", components: competitors,
        options: competitors.map((winner) => ({ id: winner.component.id, label: winner.component.displayName,
          assignments: Object.assign({}, ...competitors.map((other) => componentOptions(other).find((option) => option.id === (other === winner ? candidates[0] : "entry"))!.assignments)),
        })),
      });
      continue;
    }
    const options = componentOptions(line).filter((option) => !usedSources.has(option.id as NonNullable<LineContract["automaticSource"]>));
    const acceptable = isAcceptableProposal(definition, lineSources, id);
    const proposal = acceptable
      ? options.find((option) => option.id === line.contract?.automaticSource) ?? options[0]
      : options[0];
    if (!acceptable && hasCatalogDisambiguation(line.component.blueprintKey) && candidates.length > 1) {
      plan.decisions.push({ id, kind: "source", components: [line], options });
    } else if (hasReviewed) {
      // Pending additions stay explicit across later, unrelated observations.
      plan.decisions.push({ id, kind: "added", components: [line],
        options: [proposal, ...options.filter((option) => option !== proposal)] });
    } else {
      plan.defaults.push({ ...line, proposal, options });
    }
  }
  return plan;
}

/** Only server-offered option IDs are accepted, never client-supplied contracts. */
export function assignmentsFromPlan(plan: RemovalTemplateSetupPlan, answers: Record<string, string>, overrides: Record<string, string>): Record<string, SetupAssignment> {
  const assignments: Record<string, SetupAssignment> = {};
  if (Object.keys(answers).some((id) => !plan.decisions.some((decision) => decision.id === id)) ||
      Object.keys(overrides).some((id) => !plan.defaults.some((line) => line.component.id === id))) {
    throw new SafeError("Choose only the component options offered in this setup.");
  }
  for (const decision of plan.decisions) {
    const option = decision.options.find((candidate) => candidate.id === answers[decision.id]);
    if (!option) throw new SafeError("Answer every component decision before applying setup.");
    Object.assign(assignments, option.assignments);
  }
  for (const line of plan.defaults) {
    const optionId = overrides[line.component.id] ?? line.proposal.id;
    const option = line.options.find((candidate) => candidate.id === optionId);
    if (!option) throw new SafeError("Choose an offered option for this component.");
    Object.assign(assignments, option.assignments);
  }
  const usedSources = new Set<AutomaticSourceId>();
  const allAssignments = { ...Object.fromEntries(plan.decided.map((line) => [line.component.id, line.contract])), ...assignments };
  for (const assignment of Object.values(allAssignments)) {
    const source = assignment?.automaticSource;
    if (!source) continue;
    if (usedSources.has(source)) {
      const label = SOURCE_LABELS[source];
      throw new SafeError(`${label ? `${label} is selected more than once. ` : ""}Each source can fill only one component. Choose a different source or Neither, entry.`);
    }
    usedSources.add(source);
  }
  return assignments;
}

/** Includes decided sources and current defaults; unanswered decisions take nothing. */
export function sourcesTakenElsewhere(plan: RemovalTemplateSetupPlan, answers: Record<string, string>, overrides: Record<string, string>, componentOrDecisionId: string): Set<AutomaticSourceId> {
  const assignments: Record<string, SetupAssignment | undefined> = Object.fromEntries(plan.decided.map((line) => [line.component.id, line.contract]));
  for (const decision of plan.decisions) {
    Object.assign(assignments, decision.options.find((option) => option.id === answers[decision.id])?.assignments);
  }
  for (const line of plan.defaults) {
    Object.assign(assignments, line.options.find((option) => option.id === (overrides[line.component.id] ?? line.proposal.id))?.assignments);
  }
  const excluded = new Set(plan.decisions.find((decision) => decision.id === componentOrDecisionId)?.components.map((line) => line.component.id) ?? [componentOrDecisionId]);
  return new Set(Object.entries(assignments).flatMap(([componentId, assignment]) =>
    !excluded.has(componentId) && assignment?.automaticSource ? [assignment.automaticSource] : []));
}
