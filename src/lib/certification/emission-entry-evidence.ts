import { READOUT_INPUT_KEYS, CONCENTRATION_MASS_FLOW_INPUT_KEYS, MASS_DISTANCE_INPUT_KEYS } from "@/lib/isometric/template-observations/entry-policies";
import { entriesNeedFiles, type FilePolicy } from "@/lib/isometric/template-observations/file-policies";
import { canonicalDecimal } from "@/lib/isometric/template-observations/units";

/** Whether the entry's amount is exactly 0: a single value (incl. operating hours),
 * the readout difference, or the product of a paired entry. Unknown shapes fail closed. */
export function entryAmountIsZero(values: readonly { inputKey: string; magnitude: string }[]): boolean {
  const amounts = new Map(values.map(value => [value.inputKey, canonicalDecimal(value.magnitude)]));
  if (amounts.size !== values.length || [...amounts.values()].some(value => value === undefined)) return false;
  if (values.length === 1) return amounts.get(values[0].inputKey) === "0";
  if (values.length !== 2) return false;
  if (amounts.has(READOUT_INPUT_KEYS[0]) && amounts.has(READOUT_INPUT_KEYS[1]))
    return amounts.get(READOUT_INPUT_KEYS[0]) === amounts.get(READOUT_INPUT_KEYS[1]);
  for (const [left, right] of [CONCENTRATION_MASS_FLOW_INPUT_KEYS, MASS_DISTANCE_INPUT_KEYS]) {
    if (amounts.has(left) && amounts.has(right)) return amounts.get(left) === "0" || amounts.get(right) === "0";
  }
  return false;
}

export function entryNeedsFile(policy: FilePolicy, entry: { kind: "value" | "zero"; isZero?: boolean }): boolean {
  return entry.kind === "value" && entriesNeedFiles(policy) && !entry.isZero;
}

/** The check behind the "File missing" state, shared with surfaces that list entries. */
export function entryFileMissing(
  policy: FilePolicy, entry: { kind: "value" | "zero"; isZero?: boolean; hasEvidence: boolean },
): boolean {
  return entryNeedsFile(policy, entry) && !entry.hasEvidence;
}
