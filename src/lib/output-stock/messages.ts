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
