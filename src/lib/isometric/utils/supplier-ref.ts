import { createHash } from "node:crypto";

type Role = "removal" | "datapoint";

const ENTITY_PREFIX_LEN = 12;
const INPUT_KEY_SLUG_MAX = 32;
const INPUT_KEY_HASH_LEN = 8;

export interface BuildRemovalSupplierRefArgs {
  removalId: string;
  role: Role;
  version: number;
  inputKey?: string;
}

// Per-removal supplier reference. One Isometric Removal == one certifierRemovals
// row (N credit batches may map into it), so removal and datapoint refs are
// keyed on the removal id. The `nm-rmv-` prefix never collides with the legacy
// `nm-pr-` (per-run) or `nm-cb-` (per-batch) refs. The version suffix makes a
// superseded-then-resubmitted removal claim a fresh Isometric resource.
export function buildRemovalSupplierRef(
  args: BuildRemovalSupplierRefArgs,
): string {
  const short = shortHash(args.removalId, ENTITY_PREFIX_LEN);
  if (args.role === "removal") {
    return `nm-rmv-${short}-removal-v${args.version}`;
  }
  if (!args.inputKey) {
    throw new Error(
      "buildRemovalSupplierRef: inputKey required for datapoint role",
    );
  }
  const slug = slugify(args.inputKey);
  const hash = shortHash(args.inputKey, INPUT_KEY_HASH_LEN);
  return `nm-rmv-${short}-dp-${slug}-${hash}-v${args.version}`;
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
