/** The setup read and action refuse a facility with no Isometric project link with this sentence; the summary card branches on it. */
export const SETUP_NOT_LINKED_MESSAGE = "Link this facility to an Isometric project first.";

export const REMOVAL_TEMPLATE_BLOCKERS = {
  forbiddenLine: "This component belongs at the project level in Isometric.",
  notRemovalTemplate: "This template is not a Removal template. Choose a Removal template for this credit batch.",
  unpinnedTemplate: "Choose a Removal template for this credit batch.",
  mixedTemplatePins: "These credit batches use different Removal templates.",
  templateNotFound: "Template no longer exists in Isometric.",
  templateNotFullyRead: "Template not fully read. Try again.",
  missingFixedDatapoint: "Set each value in the Isometric template editor before submitting.",
  templateLinesNeedReview: "This Removal template has components to decide. Decide them in Removal templates.",
} as const;
/**
 * Landing line for a deep link to a credit batch's template block when the
 * block has no Notice of its own (the pin exists and Isometric lists it). The
 * link does not carry which blocker sent the operator, so this fits all of them.
 */
export const REMOVAL_TEMPLATE_LANDING_LINE = "Check this credit batch's Removal template before submitting a Removal.";
export type RemovalTemplateBlockerCode = keyof typeof REMOVAL_TEMPLATE_BLOCKERS;
export interface RemovalTemplateBlocker { code: RemovalTemplateBlockerCode; message: string }
export function removalTemplateBlocker(code: RemovalTemplateBlockerCode): RemovalTemplateBlocker {
  return { code, message: REMOVAL_TEMPLATE_BLOCKERS[code] };
}

/** Per-line template blocker codes, routed by the same table as the template codes. */
export type TemplateLineBlockerCode = "lineNeedsReview" | "lineNeedsSetup" | "lineHasNoSource";
/** Every blocker code that is settled on the template or the batch's template pin. */
export type TemplateRoutedBlockerCode = RemovalTemplateBlockerCode | TemplateLineBlockerCode;

/**
 * Where an operator settles a template blocker. The one routing table:
 * - `creditBatchTemplate`: the credit batch's own template pin (Switch template);
 * - `templateLineReview`: lines without a decision (Decide components);
 * - `templateLines`: decided lines or a read problem (Open Removal templates);
 * - `templateReplacement`: a decided line only another template can fill
 *   (Switch template, else Open Removal templates). Set as data by the line
 *   binding; no code maps to it by default.
 */
export type RemovalTemplateBlockerDestination = "creditBatchTemplate" | "templateLineReview" | "templateLines" | "templateReplacement";
const BLOCKER_DESTINATIONS: Record<TemplateRoutedBlockerCode, RemovalTemplateBlockerDestination> = {
  forbiddenLine: "templateLines",
  notRemovalTemplate: "creditBatchTemplate",
  unpinnedTemplate: "creditBatchTemplate",
  mixedTemplatePins: "creditBatchTemplate",
  templateNotFound: "creditBatchTemplate",
  templateNotFullyRead: "templateLines",
  // Line review cannot supply a fixed value. The operator can switch to a corrected template.
  missingFixedDatapoint: "creditBatchTemplate",
  templateLinesNeedReview: "templateLineReview",
  lineNeedsReview: "templateLineReview",
  lineNeedsSetup: "templateLines",
  lineHasNoSource: "templateLines",
};
export function removalTemplateBlockerDestination(code: TemplateRoutedBlockerCode): RemovalTemplateBlockerDestination {
  return BLOCKER_DESTINATIONS[code];
}
/** Whether a blocker code is settled on the template or the pin (and so has a row in the table). */
export function isTemplateRoutedCode(code: string): code is TemplateRoutedBlockerCode {
  return Object.hasOwn(BLOCKER_DESTINATIONS, code);
}
