import { SOURCE_IDS, type AutomaticSourceId } from "./catalog-sources";
import { canonicalDecimal } from "./units";
import type { LineContract } from "./line-sources";

export const FILE_POLICIES = ["lineFile", "entryFiles", "generated", "none"] as const;
export type FilePolicy = typeof FILE_POLICIES[number];
export const LINE_FILE_SOURCES = [
  SOURCE_IDS.totalGensetDieselLitres,
  SOURCE_IDS.totalStartupDieselLitres,
  SOURCE_IDS.totalElectricityKwh,
] as const;
const GENERATED_FILE_SOURCES = [
  "feedstock-transport", "delivery-transport", "sample-transport", "sequestration",
] as const satisfies readonly AutomaticSourceId[];
type FileContract = Pick<LineContract, "automaticSource" | "entryPolicy" | "filePolicy">;

function supportsComponentFile(contract: FileContract): boolean {
  return LINE_FILE_SOURCES.some((source) => source === contract.automaticSource);
}

export function allowedFilePolicies(contract: FileContract): FilePolicy[] {
  return FILE_POLICIES.filter((policy) => policy !== "lineFile" || supportsComponentFile(contract));
}

export function defaultFilePolicy(contract: FileContract): FilePolicy {
  if (supportsComponentFile(contract)) return "lineFile";
  if (GENERATED_FILE_SOURCES.some((source) => source === contract.automaticSource)) return "generated";
  return contract.entryPolicy !== "none" ? "entryFiles" : "none";
}

/** Stale stored settings fall back to the component's current default. */
export function effectiveFilePolicy(contract: FileContract): FilePolicy {
  return contract.filePolicy && allowedFilePolicies(contract).includes(contract.filePolicy)
    ? contract.filePolicy : defaultFilePolicy(contract);
}

/** A component file covers From records; manual entries still need their own files. */
export function entriesNeedFiles(policy: FilePolicy): boolean {
  return policy !== "none";
}

/** Unknown totals fail closed; exact recorded zero needs no component file. */
export function recordsNeedFile(policy: FilePolicy, recordsTotal: string): boolean {
  return policy === "lineFile" && canonicalDecimal(recordsTotal) !== "0";
}
