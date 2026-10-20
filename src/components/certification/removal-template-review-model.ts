/**
 * Plain-language copy and the pure review rules behind the Removal template
 * line review (Certification settings). Line contracts, sources and problems
 * keep their stable ids in data; this module is the one place they become
 * operator words, so the review card and its tests read the same strings.
 */
import type { useRemovalTemplateReview } from "@/hooks/use-removal-template-review";
import type { ReviewRemovalTemplateLinesInput } from "@/schemas/removal-template-review";
import type { AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";
import type { ComponentChange } from "@/lib/isometric/template-observations/compare";
import {
  isAcceptableProposal,
  lineNeedsReview as contractNeedsReview,
  type LineContract,
  type LineSourceProblem,
  type LineSources,
} from "@/lib/isometric/template-observations/line-sources";
import type { ComponentEnrichment, EntryPolicy, QuantityKind } from "@/lib/isometric/template-observations/types";
import { humanizeEnum, MISSING_VALUE } from "@/lib/copy-utils";
import { isTemplateReady, linesToDecideCount } from "@/lib/certification/removal-template-readiness";
import { sectionTemplateLines, type TemplateLineSection } from "@/lib/isometric/template-observations/template-sections";
import { linesToDecideLabel, TEMPLATE_NOT_FULLY_READ_TITLE } from "@/lib/certification/requirement-labels";

export { linesToDecideLabel, TEMPLATE_NOT_FULLY_READ_TITLE };
/** Section grouping, lines still to decide and readiness, under the names the review uses. */
export { isTemplateReady, linesToDecideCount, sectionTemplateLines };

export type RemovalTemplateReviewEntry = NonNullable<
  ReturnType<typeof useRemovalTemplateReview>["data"]
>[number];
export type RemovalTemplateReviewLine = RemovalTemplateReviewEntry["lines"][number];
export type LineAssignment = ReviewRemovalTemplateLinesInput["assignments"][string];
export type LineScope = LineContract["scope"];

export const SCOPE_LABELS: Record<LineScope, string> = {
  operating: "Operating",
  forbidden: "Establishment or end of life (not sent)",
  unassigned: MISSING_VALUE.notSet,
};

/** The scopes an Owner or Admin can assign. Unassigned is the absence of one. */
export const ASSIGNABLE_SCOPES = ["operating", "forbidden"] as const satisfies readonly LineScope[];

export const ENTRY_POLICY_LABELS: Record<EntryPolicy, string> = {
  none: "No entries",
  additive: "Entries add to the total",
  single: "One entry per batch",
};

export const SOURCE_LABELS: Record<AutomaticSourceId, string> = {
  "run-genset-diesel": "Generator diesel from production runs",
  "run-startup-diesel": "Startup diesel from production runs",
  "run-electricity": "Electricity from production runs",
  "feedstock-transport": "Feedstock transport legs",
  "delivery-transport": "Delivery transport legs",
  "sample-transport": "Sample transport legs",
  "feedstock-dry-mass": "Feedstock dry mass",
  "biochar-dry-mass": "Biochar dry mass",
  sequestration: "Applications and lab results",
  "safety-margin": "Safety margin on biochar dry mass",
};

export const ORIGIN_LABELS: Record<LineContract["origin"], string> = {
  bootstrap: "Set by noma",
  carried: "Kept from the last read",
  reviewed: "Decided",
  proposed: "Proposed by noma",
};

/** Line badges. Unchanged lines carry none. */
export const CHANGE_LABELS: Partial<Record<ComponentChange, string>> = {
  changed: "Changed",
  added: "New line",
  cosmetic: "Wording changed",
};

/** `unassigned` is shown as the To decide badge, not as a sentence. */
const PROBLEM_COPY: Partial<Record<LineSourceProblem["code"], string>> = {
  "single-with-automatic-source":
    "One entry per batch cannot add to automatic datapoints. Remove the automatic datapoints.",
  "foreign-automatic-source": "These automatic datapoints do not fit this line. Choose others.",
  "disallowed-entry-policy": "This entry rule does not fit the line's inputs. Choose another one.",
  ambiguous: "Another line uses the same automatic datapoints. Give them to one line only.",
  "missing-contract": "This line has no contract yet. Assign one.",
};

/** The badge on a line without a saved decision. */
export const TO_DECIDE_LABEL = "To decide";
export const DEPRECATED_FACTORS_LABEL = "Deprecated factors";

export function sourceLabel(source: AutomaticSourceId | undefined): string {
  return source ? SOURCE_LABELS[source] : MISSING_VALUE.none;
}

export function problemMessages(line: RemovalTemplateReviewLine, problems: readonly LineSourceProblem[]): string[] {
  return [...new Set(problems
    .filter((problem) => problem.componentId === line.component.id)
    .flatMap((problem) => PROBLEM_COPY[problem.code] ?? []))];
}

/**
 * Proposed, unassigned or contradictory lines block Removals until reviewed.
 * The server applies the same rule, so only these lines take an assignment.
 */
export function lineNeedsReview(line: RemovalTemplateReviewLine, problems: readonly LineSourceProblem[]): boolean {
  return contractNeedsReview(line.component.id, line.contract, problems);
}

/** `mass_fraction_dry_basis` reads as "Mass fraction dry basis". */
export function quantityKindLabel(kind: QuantityKind): string {
  return humanizeEnum(kind);
}

/** The unit Isometric gave this input, or the not-available token when it gave none. */
export function inputUnitLabel(enrichment: ComponentEnrichment | undefined, inputKey: string): string {
  const input = enrichment?.[inputKey];
  return input && "unit" in input && input.unit ? input.unit : MISSING_VALUE.notAvailable;
}

/**
 * Accept proposal is offered only when the proposal, saved unchanged next to
 * the other unsaved lines, would pass the server's validation (#1198). The
 * rule itself is `isAcceptableProposal`; this only adds the drafts.
 */
export function canAcceptProposal(
  entry: RemovalTemplateReviewEntry,
  line: RemovalTemplateReviewLine,
  drafts: Readonly<Record<string, LineAssignment>>,
): boolean {
  if (!entry.observation) return false;
  const drafted: LineSources = Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [
    id, { ...draft, origin: "reviewed" as const },
  ]));
  const { definition, lineSources } = entry.observation;
  return isAcceptableProposal(definition, { ...lineSources, ...drafted }, line.component.id);
}

export function assignmentFromContract(contract: LineContract): LineAssignment {
  return {
    scope: contract.scope,
    entryPolicy: contract.entryPolicy,
    ...(contract.automaticSource ? { automaticSource: contract.automaticSource } : {}),
  };
}

/**
 * Applies one select change and keeps the draft valid where the server would
 * refuse it: only operating lines take a source or entries, and a single entry
 * never adds to automatic datapoints.
 */
export function updateAssignment(current: LineAssignment, change: Partial<LineAssignment>): LineAssignment {
  const next: LineAssignment = { ...current, ...change };
  if ("automaticSource" in change && !change.automaticSource) delete next.automaticSource;
  if (next.scope !== "operating") return { scope: next.scope, entryPolicy: "none" };
  if (next.entryPolicy === "single") delete next.automaticSource;
  return next;
}

/** The template's read is incomplete: no units or factors read, or an input left unread. */
export function isNotFullyRead(entry: RemovalTemplateReviewEntry): boolean {
  return entry.availability === "listed" && (!entry.enrichment || entry.enrichmentProblems.length > 0);
}

export function templateName(entry: RemovalTemplateReviewEntry): string {
  return entry.template?.display_name ?? MISSING_VALUE.notAvailable;
}

/** Fixed factors Isometric reports as deprecated, or null when it reports none. */
export function deprecatedFactorCount(entry: RemovalTemplateReviewEntry): number | null {
  const flags = Object.values(entry.enrichment ?? {})
    .flatMap((inputs) => Object.values(inputs))
    .flatMap((input) => ("status" in input || input.deprecated == null ? [] : [input.deprecated]));
  return flags.length === 0 ? null : flags.filter(Boolean).length;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One sentence on what moved since the previous read of this template. */
export function changeSummary(changes: RemovalTemplateReviewEntry["changes"]): string {
  const values = Object.values(changes);
  if (values.length === 0) return "No earlier read to compare with.";
  const count = (change: ComponentChange) => values.filter((value) => value === change).length;
  const parts = [
    count("changed") && plural(count("changed"), "line changed", "lines changed"),
    count("added") && plural(count("added"), "new line", "new lines"),
    count("removed") && plural(count("removed"), "line removed", "lines removed"),
    count("cosmetic") && plural(count("cosmetic"), "wording change", "wording changes"),
  ].filter(Boolean);
  return parts.length === 0 ? "No changes since the last read." : `Since the last read: ${parts.join(", ")}.`;
}

export function reviewCountSummary(lineCount: number, toDecide: number): string {
  return toDecide === 0
    ? `${plural(lineCount, "line", "lines")}, all decided.`
    : `${toDecide} of ${plural(lineCount, "line", "lines")} to decide.`;
}

/** Isometric's section names on its template page. */
export const SECTION_LABELS: Record<TemplateLineSection, string> = {
  mitigated: "Mitigated",
  emitted: "Emitted",
};

/** "Pyrolysis (3)", as Isometric counts a section or group. */
export function countedLabel(name: string, count: number): string {
  return `${name} (${count})`;
}

/** The title of a template no one has set up yet. */
export const NOT_SET_UP_TITLE = "Not set up yet";

/** Whether a Removal template can be chosen for a credit batch, and why not. */
export interface TemplateReadiness {
  ready: boolean;
  /** Why it cannot be chosen yet: "3 lines to decide", "Not set up yet". */
  reason?: string;
  /** Lines without a decision; only then does the link say "Decide lines". */
  toDecide?: number;
}

/** Why a template cannot be chosen yet, in the words Removal templates uses. */
export function templateReadiness(entry: RemovalTemplateReviewEntry): TemplateReadiness {
  if (isTemplateReady(entry)) return { ready: true };
  const toDecide = linesToDecideCount(entry);
  if (toDecide > 0) return { ready: false, reason: linesToDecideLabel(toDecide), toDecide };
  if (entry.enrichmentProblems.length > 0) return { ready: false, reason: TEMPLATE_NOT_FULLY_READ_TITLE };
  return { ready: false, reason: NOT_SET_UP_TITLE };
}
