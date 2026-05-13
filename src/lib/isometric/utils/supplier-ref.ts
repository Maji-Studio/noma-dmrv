import { createHash } from "node:crypto";

type Role = "removal" | "datapoint";

const CREDIT_BATCH_PREFIX_LEN = 12;
const INPUT_KEY_SLUG_MAX = 32;
const INPUT_KEY_HASH_LEN = 8;

export interface BuildSupplierRefArgs {
  creditBatchId: string;
  role: Role;
  version: number;
  inputKey?: string;
}

export function buildSupplierRef(args: BuildSupplierRefArgs): string {
  const short = shortHash(args.creditBatchId, CREDIT_BATCH_PREFIX_LEN);
  if (args.role === "removal") {
    return `nm-cb-${short}-removal-v${args.version}`;
  }
  if (!args.inputKey) {
    throw new Error("buildSupplierRef: inputKey required for datapoint role");
  }
  const slug = slugify(args.inputKey);
  const hash = shortHash(args.inputKey, INPUT_KEY_HASH_LEN);
  return `nm-cb-${short}-dp-${slug}-${hash}-v${args.version}`;
}

function shortHash(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, INPUT_KEY_SLUG_MAX);
}
