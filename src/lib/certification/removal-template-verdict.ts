import { lineNeedsReview, type LineContract, type LineSourceProblem } from "@/lib/isometric/template-observations/line-sources";
import { sequestrationTemplateSelectionError, type SequestrationSelectionTemplate } from "@/lib/isometric/sequestration-template-selection";
import { hasMissingFixedDatapoint, type TemplateFixedInputs } from "./template-fixed-datapoints";
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
  listed: boolean;
  removalType: boolean;
  fullyRead: boolean;
  fixedValuesSet: boolean;
  sequestrationSelectable: boolean;
  /** Existing selection-guard message, retained by the switch action. */
  sequestrationError: string | null;
  toDecideIds: string[];
  toDecideCount: number;
  ready: boolean;
  blocker: RemovalTemplateBlockerCode | null;
  /** Blockers decisions cannot resolve. A read-only preview needs no observation to enter setup. */
  setupBlocker: RemovalTemplateBlockerCode | null;
}

export function removalTemplateVerdict(entry: RemovalTemplateVerdictEntry): RemovalTemplateVerdict {
  const listed = entry.availability === "listed" && entry.template !== null;
  const removalType = entry.template?.credit_type === "REMOVAL";
  const fullyRead = entry.observation !== null && entry.enrichmentProblems.length === 0;
  const fixedValuesSet = entry.template !== null && !hasMissingFixedDatapoint(entry.template);
  const sequestrationError = entry.template ? sequestrationTemplateSelectionError(entry.template) : null;
  const sequestrationSelectable = entry.template !== null && sequestrationError === null;
  const toDecideIds = [...new Set(entry.lines.filter((line) =>
    lineNeedsReview(line.component.id, line.contract, entry.lineSourceProblems)).map((line) => line.component.id))];
  const structuralBlocker = !listed ? "templateNotFound" : !removalType ? "notRemovalTemplate" :
    !sequestrationSelectable ? "unsupportedSequestration" : !fixedValuesSet ? "missingFixedDatapoint" : null;
  const blocker = structuralBlocker ?? (toDecideIds.length > 0 ? "templateLinesNeedReview" : !fullyRead ? "templateNotFullyRead" : null);
  const setupBlocker = structuralBlocker ?? (entry.enrichmentProblems.length > 0 ? "templateNotFullyRead" : null);
  return { listed, removalType, fullyRead, fixedValuesSet, sequestrationSelectable, sequestrationError,
    toDecideIds, toDecideCount: toDecideIds.length, ready: blocker === null, blocker, setupBlocker };
}
