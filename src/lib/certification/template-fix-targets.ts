import { LINE_NO_MAPPING_MESSAGE, LINE_TRANSPORT_REPLACEMENT_MESSAGE } from "@/lib/isometric/emission-line-constants";
import type { UnbindableTemplateInput } from "@/lib/isometric/template-binding-coverage";
import type { RemovalBlocker, RemovalBlockerCode } from "./removal-blockers";
import { removalTemplateBlockerDestination } from "./removal-template-blockers";

export type TemplateFixTarget = "creditBatchTemplate" | "templateLineReview" | "templateLines" | "templateReplacement";

/** A line can be decided but still need a corrected template. */
export function templateFixTarget(code: RemovalBlockerCode): TemplateFixTarget {
  switch (code) {
    case "templateLinesNeedReview":
    case "lineNeedsReview":
      return "templateLineReview";
    case "templateNotFullyRead":
    case "forbiddenLine":
    case "lineNeedsSetup":
    case "lineHasNoSource":
    case "entryMissingEvidence":
    case "feedstockTypeMapping":
    case "entityReadiness":
    case "durabilityTier":
    case "durabilityConfiguration":
    case "legacy":
      return "templateLines";
    default:
      return removalTemplateBlockerDestination(code);
  }
}

export function templateLineFixTarget(blocker: Pick<RemovalBlocker, "code" | "message">): TemplateFixTarget {
  if (blocker.message.includes(LINE_NO_MAPPING_MESSAGE) || blocker.message.includes(LINE_TRANSPORT_REPLACEMENT_MESSAGE)) {
    return "templateReplacement";
  }
  return templateFixTarget(blocker.code);
}

export function templateCoverageFixTarget(input: UnbindableTemplateInput): TemplateFixTarget {
  switch (input.reason) {
    case "unassigned":
    case "ambiguous":
      return "templateLineReview";
    case "unmapped":
      return "templateReplacement";
    case "project-scope":
    case "unrecognized-component":
      return "templateLines";
  }
}
