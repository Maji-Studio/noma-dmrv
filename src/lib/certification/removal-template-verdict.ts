import { lineNeedsReview, type LineContract, type LineSourceProblem } from "@/lib/isometric/template-observations/line-sources";
import { sequestrationTemplateSelectionError, type SequestrationSelectionTemplate } from "@/lib/isometric/sequestration-template-selection";
import { hasMissingFixedDatapoint, type TemplateFixedInputs } from "./template-fixed-datapoints";
import { removalTemplateTypeBlocker } from "./listed-removal-template";
import type { RemovalTemplateBlockerCode } from "./removal-template-blockers";

/** Structural read-model contract, usable by both server actions and clients. */
export interface RemovalTemplateVerdictEntry {
  availability: "listed" | "missing";
  template: ({ credit_type: string } & TemplateFixedInputs & SequestrationSelectionTemplate) | null;
  observation: object | null;
  enrichmentProblems: readonly unknown[];
  lineSourceProblems: readonly LineSourceProblem[];
  lines: readonly { component: { id: string }; contract: LineContract | undefined }[];
}

export interface RemovalTemplateVerdict {
  toDecideCount: number;
  blockers: RemovalTemplateBlockerCode[];
  ready: boolean;
  blocker: RemovalTemplateBlockerCode | null;
  /** Blockers decisions cannot resolve. A read-only preview needs no observation to enter setup. */
  setupBlocker: RemovalTemplateBlockerCode | null;
}

export function removalTemplateVerdict(
  entry: RemovalTemplateVerdictEntry, purpose: "selection" | "pinned" = "selection",
): RemovalTemplateVerdict {
  const listed = entry.availability === "listed" && entry.template !== null;
  const typeBlocker = entry.template ? removalTemplateTypeBlocker(entry.template) : null;
  const fullyRead = entry.observation !== null && entry.enrichmentProblems.length === 0;
  const fixedValuesSet = entry.template !== null && !hasMissingFixedDatapoint(entry.template);
  // Storage selection is a configuration-time guard, never a new health gate for an existing pin.
  const sequestrationError = purpose === "selection" && entry.template ? sequestrationTemplateSelectionError(entry.template) : null;
  const toDecideIds = [...new Set(entry.lines.filter((line) =>
    lineNeedsReview(line.component.id, line.contract, entry.lineSourceProblems)).map((line) => line.component.id))];
  const structuralBlocker = !listed ? "templateNotFound" : typeBlocker ??
    (sequestrationError ? "unsupportedSequestration" : !fixedValuesSet ? "missingFixedDatapoint" : null);
  const blockers: RemovalTemplateBlockerCode[] = [];
  if (!listed) blockers.push("templateNotFound");
  if (purpose === "pinned") {
    // Live facts validate every component, so their problems agree with toDecideIds.
    // Keep the facts-based rule for independently supplied facts too, in batch order.
    // Credit type is checked by submission preparation, preserving its blocker order.
    if (!fullyRead) blockers.push("templateNotFullyRead");
    if (!fixedValuesSet) blockers.push("missingFixedDatapoint");
    if (entry.lineSourceProblems.length > 0) blockers.push("templateLinesNeedReview");
  } else {
    if (typeBlocker) blockers.push(typeBlocker);
    if (sequestrationError) blockers.push("unsupportedSequestration");
    if (!fixedValuesSet) blockers.push("missingFixedDatapoint");
    if (toDecideIds.length > 0) blockers.push("templateLinesNeedReview");
    if (!fullyRead) blockers.push("templateNotFullyRead");
  }
  const blocker = blockers[0] ?? null;
  const setupBlocker = structuralBlocker ?? (entry.enrichmentProblems.length > 0 ? "templateNotFullyRead" : null);
  return { toDecideCount: toDecideIds.length, blockers, ready: blocker === null, blocker, setupBlocker };
}
