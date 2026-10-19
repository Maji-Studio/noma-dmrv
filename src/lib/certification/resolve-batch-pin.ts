/** Partial pins are unpinned before they can be classified as mixed. */
export function resolveBatchPin(batches: readonly { removalTemplateId: string | null }[]):
  { pin: string } | { code: "unpinnedTemplate" | "mixedTemplatePins" } {
  if (!batches.length || batches.some((batch) => !batch.removalTemplateId)) return { code: "unpinnedTemplate" };
  const pins = new Set(batches.map((batch) => batch.removalTemplateId!));
  if (pins.size !== 1) return { code: "mixedTemplatePins" };
  return { pin: [...pins][0] };
}
