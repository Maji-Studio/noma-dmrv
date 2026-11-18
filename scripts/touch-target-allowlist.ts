/** Narrow exceptions to the explicit-height gate. Every entry needs a reason. */
export const TOUCH_TARGET_ALLOWLIST: ReadonlyArray<{
  file: string;
  tag: string;
  utility: string;
  reason: string;
}> = [
  { file: "src/components/certification/isometric-link.tsx", tag: "a", utility: "min-h-24",
    reason: "Sanctioned IsometricLink 24px inline glyph; docs/design-system.md preserves label alignment." },
  { file: "src/components/certification/isometric-link.tsx", tag: "a", utility: "size-24",
    reason: "Sanctioned IsometricLink 24px icon beside its ID; docs/design-system.md." },
  { file: "src/components/ui/explanation-info/index.tsx", tag: "span", utility: "min-h-24",
    reason: "Sanctioned ExplanationInfo 24px glyph; docs/design-system.md preserves label alignment." },
  { file: "src/components/ui/tooltip/index.tsx", tag: "button", utility: "min-h-24",
    reason: "Sanctioned InfoHint 24px glyph; docs/design-system.md preserves label alignment." },
  { file: "src/components/api-keys/api-key-permission-grid.tsx", tag: "input", utility: "size-16",
    reason: "The wrapping label is the checkbox target and already has min-h-44 min-w-44." },
  { file: "src/components/certification/new-removal-dialog/batch-box.tsx", tag: "input", utility: "size-16",
    reason: "The full grid label toggles the checkbox; two text rows plus py-12 exceed 44px." },
  { file: "src/components/storage-locations/sub-bin-bays.tsx", tag: "Button", utility: "min-h-0",
    reason: "Proportional diagram bands cannot grow without changing the mass chart; adjacent BinParts exposes the same details through row controls." },
  { file: "src/components/emissions/emission-entry-files.tsx", tag: "a", utility: "min-h-24",
    reason: "File links stack 2px apart; a 44px hit area on each would overlap its neighbour and open the wrong file. 24px meets WCAG 2.5.8." },
  { file: "src/components/chain-of-custody/run-picker.tsx", tag: "button", utility: "h-40",
    reason: "Clear button sits inside the picker trigger; a 44px area would cover the trigger it sits on and clear the filter on a missed tap." },
  { file: "src/components/emissions/emission-line-body-parts.tsx", tag: "Link", utility: "min-h-24",
    reason: "Inline source link in a wrapping row; a 44px hit area would overlap the rows around it. 24px meets WCAG 2.5.8." },
  { file: "src/components/emissions/emission-line-body-parts.tsx", tag: "a", utility: "min-h-24",
    reason: "Entry file links wrap 2px apart; 44px hit areas would overlap and open the wrong file. 24px meets WCAG 2.5.8." },
  { file: "src/components/schema/schema-table-view.tsx", tag: "button", utility: "h-[32px]",
    reason: "Developer schema page: wrapped table tabs sit 6px apart, so 44px hit areas would overlap." },
  { file: "src/components/storage-locations/sub-bin-card.tsx", tag: "Button", utility: "h-24",
    reason: "Info glyph sits 8px from the label and Move up control; a 44px hit area would overlap both. 24px meets WCAG 2.5.8." },
  { file: "src/components/storage-locations/sub-bin-card.tsx", tag: "Button", utility: "min-h-24",
    reason: "Same info glyph as its h-24 entry." },
  { file: "src/components/credit-batches/credit-batch-removal-bar.tsx", tag: "Link", utility: "h-18",
    reason: "Duplicate label above a proportional bar segment, aria-hidden and out of the tab order; the row below carries the same link at full size. A 44px area would overlap the bar." },
];
