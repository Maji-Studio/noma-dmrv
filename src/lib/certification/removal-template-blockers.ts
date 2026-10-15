export const REMOVAL_TEMPLATE_BLOCKERS = {
  unpinnedTemplate: "Choose a Removal template for this credit batch.",
  mixedTemplatePins: "These credit batches use different Removal templates.",
  templateNotFound: "Template no longer exists in Isometric.",
  templateNotFullyRead: "Template not fully read. Try again.",
  templateLinesNeedReview: "Review the Removal template lines in Certification settings.",
} as const;
export type RemovalTemplateBlockerCode = keyof typeof REMOVAL_TEMPLATE_BLOCKERS;
export interface RemovalTemplateBlocker { code: RemovalTemplateBlockerCode; message: string }
export function removalTemplateBlocker(code: RemovalTemplateBlockerCode): RemovalTemplateBlocker {
  return { code, message: REMOVAL_TEMPLATE_BLOCKERS[code] };
}
