import { lineNeedsReview, type LineContract, type LineSourceProblem } from "@/lib/isometric/template-observations/line-sources";

/** Structural read-model contract, usable by both server actions and clients. */
export interface RemovalTemplateReadinessEntry {
  availability: "listed" | "missing";
  template: { credit_type: string } | null;
  observation: object | null;
  enrichmentProblems: readonly unknown[];
  lineSourceProblems: readonly LineSourceProblem[];
  lines: readonly { component: { id: string }; contract: LineContract | undefined }[];
}

export function linesToDecideCount(entry: Pick<RemovalTemplateReadinessEntry, "lines" | "lineSourceProblems">): number {
  return entry.lines.filter((line) => lineNeedsReview(line.component.id, line.contract, entry.lineSourceProblems)).length;
}

export function isTemplateReady(entry: RemovalTemplateReadinessEntry): boolean {
  return entry.availability === "listed" && entry.template?.credit_type === "REMOVAL" &&
    entry.observation !== null && entry.enrichmentProblems.length === 0 && linesToDecideCount(entry) === 0;
}
