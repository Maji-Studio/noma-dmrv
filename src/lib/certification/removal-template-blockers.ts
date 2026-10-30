/** The setup read and action refuse a facility with no Isometric project link with this sentence; the summary card branches on it. */
export const SETUP_NOT_LINKED_MESSAGE = "Link this facility to an Isometric project first.";

export const REMOVAL_TEMPLATE_BLOCKERS = {
  forbiddenLine: "This component belongs at the project level in Isometric.",
  notRemovalTemplate: "This template is not a Removal template. Set a Removal template in Settings, Removal templates.",
  unpinnedTemplate: "Set a Removal template in Settings, Removal templates.",
  mixedTemplatePins: "These credit batches use different Removal templates.",
  templateNotFound: "Template no longer exists in Isometric.",
  templateNotFullyRead: "Template not fully read. Try again.",
  unsupportedSequestration: "This template uses an unsupported storage component.",
  missingFixedDatapoint: "Set each value in the Isometric template editor before submitting.",
  templateLinesNeedReview: "This Removal template has components to decide. Answer them in Settings, Removal templates.",
} as const;
/**
 * Landing line for a deep link to a credit batch's template block when the
 * block has no Notice of its own (the pin exists and Isometric lists it). The
 * link does not carry which blocker sent the operator, so this fits all of them.
 */
export const REMOVAL_TEMPLATE_LANDING_LINE = "Check this credit batch's Removal template before submitting a Removal.";
export type RemovalTemplateBlockerCode = keyof typeof REMOVAL_TEMPLATE_BLOCKERS;
/** Optional split for surfaces that can show facts without repair steps.
 * The existing message/detail remains the complete copy for other consumers.
 */
export interface BlockerCopy { detail?: string; instruction?: string }
const TEMPLATE_BLOCKER_COPY: Partial<Record<RemovalTemplateBlockerCode, BlockerCopy>> = {
  notRemovalTemplate: { detail: "This template is not a Removal template.", instruction: REMOVAL_TEMPLATE_BLOCKERS.unpinnedTemplate },
  unpinnedTemplate: { instruction: REMOVAL_TEMPLATE_BLOCKERS.unpinnedTemplate },
  templateNotFullyRead: { detail: "Template not fully read.", instruction: "Try again." },
  missingFixedDatapoint: { instruction: REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint },
  templateLinesNeedReview: { detail: "This Removal template has components to decide.", instruction: "Answer them in Settings, Removal templates." },
};
export interface RemovalTemplateBlocker { code: RemovalTemplateBlockerCode; message: string; copy?: BlockerCopy }
export function removalTemplateBlocker(code: RemovalTemplateBlockerCode): RemovalTemplateBlocker {
  return { code, message: REMOVAL_TEMPLATE_BLOCKERS[code], ...(TEMPLATE_BLOCKER_COPY[code] ? { copy: TEMPLATE_BLOCKER_COPY[code] } : {}) };
}

/** Per-line template blocker codes, routed by the same table as the template codes. */
export type TemplateLineBlockerCode = "lineNeedsReview" | "lineNeedsSetup" | "lineHasNoSource";
/** Every blocker code that is settled on the template or the batch's template pin. */
export type TemplateRoutedBlockerCode = RemovalTemplateBlockerCode | TemplateLineBlockerCode;

/**
 * Where an operator settles a template blocker. The one routing table:
 * - `templateSetup`: the facility template setup in Settings (Set template);
 * - `templateLineReview`: lines without a decision (Answer in Settings);
 * - `templateLines`: decided lines or a read problem (Open Removal templates);
 * - `templateReplacement`: a decided line only another template can fill
 *   (Set template in Settings). Set as data by the line
 *   binding; no code maps to it by default.
 */
export type RemovalTemplateBlockerDestination = "templateSetup" | "templateLineReview" | "templateLines" | "templateReplacement";
const BLOCKER_DESTINATIONS: Record<TemplateRoutedBlockerCode, RemovalTemplateBlockerDestination> = {
  forbiddenLine: "templateLines",
  notRemovalTemplate: "templateSetup",
  unpinnedTemplate: "templateSetup",
  mixedTemplatePins: "templateSetup",
  templateNotFound: "templateSetup",
  templateNotFullyRead: "templateLines",
  unsupportedSequestration: "templateSetup",
  // Line review cannot supply a fixed value. The operator can switch to a corrected template.
  missingFixedDatapoint: "templateSetup",
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
