import { entriesNeedFiles, type FilePolicy } from "@/lib/isometric/template-observations/file-policies";
import { canonicalDecimal } from "@/lib/isometric/template-observations/units";

/** Every monitored magnitude must be exactly zero, including paired inputs. */
export function entryValuesAreZero(values: readonly { magnitude: string }[]): boolean {
  return values.length > 0 && values.every((value) => canonicalDecimal(value.magnitude) === "0");
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
