import { REMOVAL_TEMPLATE_BLOCKERS } from "./removal-template-blockers";
import { hasMissingFixedDatapoint, type TemplateFixedInputs } from "./template-fixed-datapoints";

/** Blockers that answering setup decisions cannot resolve, in refusal order. */
export function setupBlockedReason(template: TemplateFixedInputs, enrichmentProblems: readonly unknown[]): string | null {
  if (hasMissingFixedDatapoint(template)) return REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint;
  if (enrichmentProblems.length) return REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead;
  return null;
}
