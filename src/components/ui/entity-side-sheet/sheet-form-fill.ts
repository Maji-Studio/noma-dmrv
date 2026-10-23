/**
 * The fieldset fills the body, and every element between it and the sticky
 * footer (`data-sheet-footer`, set by FormActions) becomes a filling flex
 * column with no bottom margin (a `space-y` sibling, even a hidden one, would
 * otherwise lift the footer), whatever shape the form has: a direct `<form>`, a wrapper `<div>`
 * around the form and its extension content, or a fragment. That lets the
 * footer's `mt-auto` pin it to the sheet bottom on short forms. Forms need no
 * class of their own.
 */
export const SHEET_FORM_FILL =
  "flex min-w-0 flex-1 flex-col " +
  "[&_:has([data-sheet-footer])]:flex [&_:has([data-sheet-footer])]:flex-1 [&_:has([data-sheet-footer])]:flex-col [&_:has([data-sheet-footer])]:mb-0";
