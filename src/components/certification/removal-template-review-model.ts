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
import type { LineContract, LineSourceProblem } from "@/lib/isometric/template-observations/line-sources";
import type { EntryPolicy } from "@/lib/isometric/template-observations/types";
import { MISSING_VALUE } from "@/lib/copy-utils";

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
  reviewed: "Reviewed",
  proposed: "Proposed by noma",
};

/** Line badges. Unchanged lines carry none. */
export const CHANGE_LABELS: Partial<Record<ComponentChange, string>> = {
  changed: "Changed",
  added: "New line",
  cosmetic: "Wording changed",
};

/** `unassigned` is shown as the Needs review badge, not as a sentence. */
const PROBLEM_COPY: Partial<Record<LineSourceProblem["code"], string>> = {
  "single-with-automatic-source":
    "One entry per batch cannot add to an automatic figure. Remove the automatic figure.",
  "foreign-automatic-source": "This automatic figure does not fit this line. Choose another one.",
  "disallowed-entry-policy": "This entry rule does not fit the line's inputs. Choose another one.",
  ambiguous: "Another line uses the same automatic figure. Give each figure to one line.",
  "missing-contract": "This line has no contract yet. Assign one.",
};

export const TEMPLATE_NOT_FULLY_READ_TITLE = "Template not fully read";
export const DEPRECATED_FACTORS_LABEL = "Deprecated factors";

export function sourceLabel(source: AutomaticSourceId | undefined): string {
  return source ? SOURCE_LABELS[source] : MISSING_VALUE.none;
}

export function problemMessages(line: RemovalTemplateReviewLine, problems: readonly LineSourceProblem[]): string[] {
  return [...new Set(problems
    .filter((problem) => problem.componentId === line.component.id)
    .flatMap((problem) => PROBLEM_COPY[problem.code] ?? []))];
}

/** Proposed, unassigned or contradictory lines block Removals until reviewed. */
export function lineNeedsReview(line: RemovalTemplateReviewLine, problems: readonly LineSourceProblem[]): boolean {
  return line.contract.origin === "proposed" || line.contract.scope === "unassigned" ||
    problems.some((problem) => problem.componentId === line.component.id);
}

/** A proposal can be accepted unchanged only when it names a scope. */
export function canAcceptProposal(line: RemovalTemplateReviewLine): boolean {
  return line.contract.origin === "proposed" && line.contract.scope !== "unassigned";
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
 * never adds to an automatic figure.
 */
export function updateAssignment(current: LineAssignment, change: Partial<LineAssignment>): LineAssignment {
  const next: LineAssignment = { ...current, ...change };
  if ("automaticSource" in change && !change.automaticSource) delete next.automaticSource;
  if (next.scope !== "operating") return { scope: next.scope, entryPolicy: "none" };
  if (next.entryPolicy === "single") delete next.automaticSource;
  return next;
}

/** The template's read is incomplete: no observation, or an input left unread. */
export function isNotFullyRead(entry: RemovalTemplateReviewEntry): boolean {
  return entry.availability === "listed" && (!entry.observation || entry.enrichmentProblems.length > 0);
}

export function templateName(entry: RemovalTemplateReviewEntry): string {
  return entry.template?.display_name ?? MISSING_VALUE.notAvailable;
}

/** Fixed factors Isometric reports as deprecated, or null when it reports none. */
export function deprecatedFactorCount(entry: RemovalTemplateReviewEntry): number | null {
  const flags = Object.values(entry.observation?.enrichment ?? {})
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

export function reviewCountSummary(lineCount: number, needsReview: number): string {
  const lines = plural(lineCount, "line", "lines");
  return needsReview === 0 ? `${lines}. All reviewed.` : `${lines}. ${needsReview} ${needsReview === 1 ? "needs" : "need"} review.`;
}

/** Lines in template order, grouped under their template group. */
export function groupLines(lines: readonly RemovalTemplateReviewLine[]) {
  const groups = new Map<string, { key: string; name: string; lines: RemovalTemplateReviewLine[] }>();
  for (const line of lines) {
    const group = groups.get(line.groupKey) ?? { key: line.groupKey, name: line.groupName, lines: [] };
    group.lines.push(line);
    groups.set(line.groupKey, group);
  }
  return [...groups.values()];
}
