/**
 * Planner failures in operator words.
 *
 * `planOutputStock` throws `RangeError`s written for the ledger invariant they
 * protect ("Insufficient exact dry solids"), and those strings are asserted by
 * the planner and allocation tests. Translation happens here, at the boundary
 * where a failure stops being an invariant and starts being something a person
 * has to act on, so the internal vocabulary never reaches a form field.
 *
 * Anything unmapped passes through unchanged: a surprising invariant failure is
 * better read verbatim than smoothed into a generic apology.
 */
const OPERATOR_MESSAGES: Record<string, string> = {
  "Insufficient exact dry solids":
    "Not enough dry biochar in the selected bin for this wet mass. Reduce the wet mass or choose another bin.",
  "Draw must be positive":
    "Enter a wet mass above zero.",
  "Draw is below one gram of dry biochar; increase the measured mass":
    "This wet mass leaves less than a gram of dry biochar. Increase the wet mass.",
};

export function operatorStockMessage(message: string): string {
  return OPERATOR_MESSAGES[message] ?? message;
}

/** The backdating notice a stock preview carries, if any; ingredient previews carry none. */
export function backdatedNotice(preview: object): string | null {
  return 'calculatedWithout' in preview && Array.isArray(preview.calculatedWithout) ? calculatedWithoutNotice(preview.calculatedWithout) : null;
}

/**
 * A mix-bin entry timed before saved removals (plan rule 19): those removals
 * keep the batch shares they were saved with, and the operator is told which.
 */
export function calculatedWithoutNotice(removals: readonly { label: string }[]): string | null {
  if (!removals.length) return null;
  const names = removals.map(removal => removal.label);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return names.length === 1
    ? `This entry is timed before a saved removal, ${list}. That removal keeps the batch shares it was saved with. Check the time, then save.`
    : `This entry is timed before ${names.length} saved removals: ${list}. Those removals keep the batch shares they were saved with. Check the time, then save.`;
}
