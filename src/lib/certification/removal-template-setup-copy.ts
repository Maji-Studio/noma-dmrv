/**
 * Operator words for the Removal template setup page. The server offers
 * options by stable id (a source id, a component id, or `entry`) and a
 * raw label; this module turns each into the sentence an operator reads, and
 * derives the pure facts (open decisions, entry counts, the start step) the
 * page and its tests share.
 */
import type { AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";
import type { LineContract } from "@/lib/isometric/template-observations/line-sources";
import { formatCount } from "@/lib/copy-utils";
import type { RemovalTemplateSetupPlan, SetupAssignment, SetupDecision, SetupOption } from "./removal-template-setup-plan";
import { sourcesTakenElsewhere } from "./removal-template-setup-plan";
import { SOURCE_LABELS } from "./removal-template-source-labels";

export type SetupStepKey = "template" | "decisions" | "apply";
export const SETUP_STEP_KEYS: readonly SetupStepKey[] = ["template", "decisions", "apply"];

/** What noma records for each source, in the words of the explanation lines. */
const SOURCE_RECORDS: Partial<Record<AutomaticSourceId, string>> = {
  "run-genset-diesel": "one generator diesel figure per production run",
  "run-startup-diesel": "one startup diesel figure per production run",
  "run-electricity": "one electricity figure per production run",
};

const SOURCE_NOUNS: Record<AutomaticSourceId, string> = {
  "run-genset-diesel": "generator diesel from production runs",
  "run-startup-diesel": "startup diesel from production runs",
  "run-electricity": "electricity from production runs",
  "feedstock-transport": "feedstock transport legs",
  "delivery-transport": "delivery transport legs",
  "sample-transport": "sample transport legs",
  "feedstock-dry-mass": "feedstock dry mass",
  "biochar-dry-mass": "biochar dry mass",
  sequestration: "applications and lab results",
  "safety-margin": "the safety margin on biochar dry mass",
};

const ENTRY_EACH_BATCH = "an emissions entry on each credit batch";
export const ENTRY_LABEL = "Emissions entry";
export const PROJECT_LABEL = "Project level (not sent)";

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as AutomaticSourceId] ?? source;
}

function sourceNoun(source: string): string {
  return SOURCE_NOUNS[source as AutomaticSourceId] ?? source;
}

function sourceRecords(source: string): string {
  return SOURCE_RECORDS[source as AutomaticSourceId] ?? `one record of ${sourceNoun(source)}`;
}

/** The source an option fills, if it fills one. */
export function optionSource(option: SetupOption): AutomaticSourceId | undefined {
  return Object.values(option.assignments).find((assignment) => assignment.automaticSource)?.automaticSource;
}

/** A human label for one offered option; the server may send a raw source id. */
export function optionLabel(option: SetupOption): string {
  if (option.id === "entry") return option.label === "Entry" ? ENTRY_LABEL : "Neither, entry";
  return SOURCE_LABELS[option.label as AutomaticSourceId] ?? option.label;
}

export function assignmentFill(assignment: SetupAssignment | undefined): string {
  if (assignment?.scope === "forbidden") return PROJECT_LABEL;
  return assignment?.automaticSource ? sourceLabel(assignment.automaticSource) : ENTRY_LABEL;
}

export function decisionQuestion(decision: SetupDecision): string {
  const first = decision.components[0].component.displayName;
  if (decision.kind === "clash") return `Which component gets ${sourceNoun(decision.id.replace("clash:", ""))}?`;
  return decision.kind === "added" ? `How should noma fill ${first}?` : `Which source fills ${first}?`;
}

export function decisionSituation(decision: SetupDecision): string {
  const first = decision.components[0].component.displayName;
  if (decision.kind === "clash") {
    const source = decision.id.replace("clash:", "");
    return `noma records ${sourceRecords(source)}. ${formatCount(decision.components.length, "component")} in this template measure ${sourceNoun(source)}, and one figure cannot fill ${decision.components.length === 2 ? "both" : "all of them"}.`;
  }
  if (decision.kind === "added") return `${first} is not decided yet for this template. noma lists its proposal first, and nothing is preselected.`;
  return `noma has more than one record that could fill ${first}. The component name does not say which one it means.`;
}

export function optionDescription(decision: SetupDecision, option: SetupOption): string {
  if (option.id === "entry") return `Record it as ${ENTRY_EACH_BATCH}.`;
  if (decision.kind === "clash") {
    const others = decision.components.filter((line) => line.component.id !== option.id).map((line) => line.component.displayName);
    return `${others.join(" and ")} then take${others.length === 1 ? "s" : ""} ${ENTRY_EACH_BATCH}.`;
  }
  return "From noma records.";
}

/** One line for What happens and the summary. */
export function answerSummary(decision: SetupDecision, option: SetupOption): string {
  const first = decision.components[0].component.displayName;
  if (decision.kind === "clash") return `${sourceNoun(decision.id.replace("clash:", "")).replace(/^./, (c) => c.toUpperCase())} fills ${option.label}`;
  if (option.id === "entry") return `${first} takes ${ENTRY_EACH_BATCH}`;
  return `${optionLabel(option)} fills ${first}`;
}

export type Answers = Record<string, string>;

export function openDecisions(plan: RemovalTemplateSetupPlan, answers: Answers): SetupDecision[] {
  return plan.decisions.filter((decision) => !decision.options.some((option) => option.id === answers[decision.id]));
}

export function toDecideLabel(count: number): string {
  return count === 0 ? "Nothing to decide" : `${count} to decide`;
}

/** Options that would give a source to two components. Decided and noma-chosen components count. */
export function takenOptionIds(plan: RemovalTemplateSetupPlan, answers: Answers, overrides: Answers, componentOrDecisionId: string, options: readonly SetupOption[]): Set<string> {
  const taken = sourcesTakenElsewhere(plan, answers, overrides, componentOrDecisionId);
  return new Set(options.filter((option) => Object.values(option.assignments).some((assignment) => assignment.automaticSource && taken.has(assignment.automaticSource))).map((option) => option.id));
}

type EntryLike = Pick<LineContract, "scope" | "automaticSource" | "entryPolicy">;
function takesEntry(assignment: EntryLike | undefined): boolean {
  return !!assignment && assignment.scope === "operating" && !assignment.automaticSource && assignment.entryPolicy !== "none";
}

/** Components that take an emissions entry on each credit batch, given the choices so far. */
export function entryCount(plan: RemovalTemplateSetupPlan, answers: Answers, overrides: Answers): number {
  const assignments: Record<string, EntryLike | undefined> = Object.fromEntries(plan.decided.map((line) => [line.component.id, line.contract]));
  for (const decision of plan.decisions) {
    Object.assign(assignments, decision.options.find((option) => option.id === answers[decision.id])?.assignments);
  }
  for (const line of plan.defaults) {
    Object.assign(assignments, line.options.find((option) => option.id === (overrides[line.component.id] ?? line.proposal.id))?.assignments);
  }
  return Object.values(assignments).filter(takesEntry).length;
}

/** Entries per batch of a template as it is stored now, for the summary card. */
export function storedEntryCount(plan: RemovalTemplateSetupPlan): number {
  return plan.decided.filter((line) => takesEntry(line.contract)).length;
}

export function parseStep(raw: string | null | undefined): SetupStepKey | null {
  return SETUP_STEP_KEYS.find((key) => key === raw) ?? null;
}

interface StartInput {
  fitting: readonly { id: string; plan: RemovalTemplateSetupPlan }[];
  templateId: string | null;
  step: SetupStepKey | null;
}

/** Where the page opens: the requested step, else Apply for the one fit with nothing to decide. */
export function startState({ fitting, templateId, step }: StartInput): { templateId: string | null; stepIndex: number } {
  const requested = fitting.find((template) => template.id === templateId) ?? (fitting.length === 1 ? fitting[0] : null);
  if (!requested) return { templateId: null, stepIndex: 0 };
  const requestedIndex = step ? SETUP_STEP_KEYS.indexOf(step) : -1;
  if (requestedIndex >= 0) return { templateId: requested.id, stepIndex: requestedIndex };
  const zeroPath = fitting.length === 1 && requested.plan.decisions.length === 0;
  return { templateId: requested.id, stepIndex: zeroPath ? 2 : 0 };
}
