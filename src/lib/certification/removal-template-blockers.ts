export const REMOVAL_TEMPLATE_BLOCKERS = {
  forbiddenLine: "This line belongs at the project level in Isometric.",
  notRemovalTemplate: "This template is not a Removal template. Choose a Removal template for this credit batch.",
  unpinnedTemplate: "Choose a Removal template for this credit batch.",
  mixedTemplatePins: "These credit batches use different Removal templates.",
  templateNotFound: "Template no longer exists in Isometric.",
  templateNotFullyRead: "Template not fully read. Try again.",
  missingFixedDatapoint: "Set each value in the Isometric template editor before submitting.",
  templateLinesNeedReview: "Review the Removal template lines in Certification settings.",
} as const;
export type RemovalTemplateBlockerCode = keyof typeof REMOVAL_TEMPLATE_BLOCKERS;
export interface RemovalTemplateBlocker { code: RemovalTemplateBlockerCode; message: string }
export function removalTemplateBlocker(code: RemovalTemplateBlockerCode): RemovalTemplateBlocker {
  return { code, message: REMOVAL_TEMPLATE_BLOCKERS[code] };
}

/**
 * Where an operator settles each blocker: the credit batch's own template pin,
 * or the line review in Certification settings.
 */
export type RemovalTemplateBlockerDestination = "creditBatchTemplate" | "templateLineReview";
const BLOCKER_DESTINATIONS: Record<RemovalTemplateBlockerCode, RemovalTemplateBlockerDestination> = {
  forbiddenLine: "templateLineReview",
  notRemovalTemplate: "creditBatchTemplate",
  unpinnedTemplate: "creditBatchTemplate",
  mixedTemplatePins: "creditBatchTemplate",
  templateNotFound: "creditBatchTemplate",
  templateNotFullyRead: "templateLineReview",
  // Line review cannot supply a fixed value. The operator can switch to a corrected template.
  missingFixedDatapoint: "creditBatchTemplate",
  templateLinesNeedReview: "templateLineReview",
};
export function removalTemplateBlockerDestination(code: RemovalTemplateBlockerCode): RemovalTemplateBlockerDestination {
  return BLOCKER_DESTINATIONS[code];
}
