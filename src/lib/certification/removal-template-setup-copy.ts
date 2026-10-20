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
import { REMOVAL_TEMPLATE_BLOCKERS } from "./removal-template-blockers";
import { SOURCE_LABELS } from "./removal-template-source-labels";

export type SetupStepKey = "template" | "decisions" | "apply";
export const SETUP_STEP_KEYS: readonly SetupStepKey[] = ["template", "decisions", "apply"];

/** What noma keeps for each source, and whether the datapoints come as one figure or a set. */
const SOURCE_KEEPS: Record<AutomaticSourceId, { keeps: string; unit: "figure" | "set" }> = {
  "run-genset-diesel": { keeps: "one generator diesel figure per production run", unit: "figure" },
  "run-startup-diesel": { keeps: "one startup diesel figure per production run", unit: "figure" },
  "run-electricity": { keeps: "one electricity figure per production run", unit: "figure" },
  "feedstock-transport": { keeps: "one set of feedstock transport legs per credit batch", unit: "set" },
  "delivery-transport": { keeps: "one set of delivery transport legs per credit batch", unit: "set" },
  "sample-transport": { keeps: "one set of sample transport legs per credit batch", unit: "set" },
  "feedstock-dry-mass": { keeps: "one feedstock dry mass per credit batch", unit: "figure" },
  "biochar-dry-mass": { keeps: "one biochar dry mass per credit batch", unit: "figure" },
  sequestration: { keeps: "one set of application and lab results per credit batch", unit: "set" },
  "safety-margin": { keeps: "one safety margin per credit batch", unit: "figure" },
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

const BLOCKED_COPY: Record<string, string> = {
  [REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint]: "Isometric has fixed values without a datapoint in this template. Set them in the Isometric template editor, then come back.",
  [REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead]: "noma could not read this template in full. Try again in a moment.",
};

/** The reason a template cannot be set up yet, in setup words. */
export function blockedCopy(reason: string): string {
  return BLOCKED_COPY[reason] ?? reason;
}

const ENTRY_EACH_BATCH = "an emissions entry on each credit batch";
export const ENTRY_LABEL = "Emissions entry";
export const PROJECT_LABEL = "Project level (not sent)";

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as AutomaticSourceId] ?? source;
}

function sourceNoun(source: string): string {
  return SOURCE_NOUNS[source as AutomaticSourceId] ?? source;
}

const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five"];
const countWord = (count: number) => COUNT_WORDS[count] ?? String(count);

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
    const { keeps, unit } = SOURCE_KEEPS[source as AutomaticSourceId] ?? { keeps: `one record of ${sourceNoun(source)}`, unit: "figure" as const };
    const count = decision.components.length;
    return `noma keeps ${keeps}. ${countWord(count)} components in this template ask for ${unit === "set" ? "them" : "it"}, and one ${unit} cannot fill ${count === 2 ? "both" : "all of them"}.`;
  }
  if (decision.kind === "added") return `${first} is not decided yet for this template. noma lists its proposal first, and nothing is preselected.`;
  const sources = decision.options.filter((option) => optionSource(option)).map((option) => sourceNoun(optionSource(option) as string));
  return `noma keeps ${sources.join(" and ")} separately. The name of ${first} does not say which one it means.`;
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
  fitting: readonly { id: string; plan: RemovalTemplateSetupPlan; blockedReason?: string | null }[];
  templateId: string | null;
  step: SetupStepKey | null;
}

/** Where the page opens: the requested step, else Apply for the one fit with nothing to decide. */
export function startState({ fitting: all, templateId, step }: StartInput): { templateId: string | null; stepIndex: number } {
  const fitting = all.filter((template) => !template.blockedReason);
  const requested = fitting.find((template) => template.id === templateId) ?? (all.length === 1 ? fitting[0] ?? null : null);
  if (!requested) return { templateId: null, stepIndex: 0 };
  const requestedIndex = step ? SETUP_STEP_KEYS.indexOf(step) : -1;
  if (requestedIndex >= 0) return { templateId: requested.id, stepIndex: requestedIndex };
  const zeroPath = all.length === 1 && requested.plan.decisions.length === 0;
  return { templateId: requested.id, stepIndex: zeroPath ? 2 : 0 };
}
