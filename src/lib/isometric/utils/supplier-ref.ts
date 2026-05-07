type Role = "removal" | "datapoint";

export interface BuildSupplierRefArgs {
  creditBatchId: string;
  role: Role;
  version: number;
  inputKey?: string;
}

export function buildSupplierRef(args: BuildSupplierRefArgs): string {
  const short = args.creditBatchId.replace(/-/g, "").slice(0, 8);
  if (args.role === "removal") {
    return `nm-cb-${short}-removal-v${args.version}`;
  }
  if (!args.inputKey) {
    throw new Error("buildSupplierRef: inputKey required for datapoint role");
  }
  const slug = slugify(args.inputKey);
  return `nm-cb-${short}-dp-${slug}-v${args.version}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
