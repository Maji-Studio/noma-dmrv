import { entriesNeedFiles, type FilePolicy } from "@/lib/isometric/template-observations/file-policies";
import { canonicalDecimal } from "@/lib/isometric/template-observations/units";

/** Every monitored magnitude must be exactly zero, including paired inputs. */
export function entryValuesAreZero(values: readonly { magnitude: string }[]): boolean {
  return values.length > 0 && values.every((value) => canonicalDecimal(value.magnitude) === "0");
}

export function entryNeedsFile(policy: FilePolicy, entry: { kind: "value" | "zero"; isZero?: boolean }): boolean {
  return entry.kind === "value" && entriesNeedFiles(policy) && !entry.isZero;
}
