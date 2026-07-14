/**
 * Shared helpers for reconciling env templates against the 1Password items
 * they reference. Used by env-local-inject.ts (tolerant `pnpm env:local`),
 * sync-env-to-vercel.ts (tolerant Vercel sync + untracked-var warnings), and
 * check-env-drift.ts (standalone drift report).
 *
 * Never returns or logs secret values — field NAMES only.
 */

import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

export const VAULT = "Environment Variables";
export const ITEM_PREFIX = "noma-dmrv env";

/**
 * Vars `src/config/env.ts` cannot boot without in dev — a missing 1Password
 * field for one of these must FAIL the sync rather than be skipped, or the
 * injected .env.local produces an app that dies at env parse time.
 */
export const REQUIRED_LOCAL_VARS = new Set([
  "DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "BETTER_AUTH_SECRET",
]);

/**
 * Vars a Vercel deployment cannot boot without (NODE_ENV=production at
 * runtime): the core trio, credential encryption key, and s3-compatible
 * storage set that env.ts mandates in production. Everything else in
 * .env.tpl degrades gracefully.
 */
export const REQUIRED_DEPLOYED_VARS = new Set([
  "DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "BETTER_AUTH_SECRET",
  "CREDENTIALS_ENCRYPTION_KEY",
  "STORAGE_PROVIDER",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
]);

// Shape of an env-var name (and therefore a per-var 1Password field label).
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export interface TemplateEntry {
  name: string;
  /** Field referenced inside the op:// path, or null for a literal value. */
  opField: string | null;
}

/** Parse an env template (default .env.tpl) into its declared variables. */
export function parseTemplate(templateFile = ".env.tpl"): TemplateEntry[] {
  const templatePath = join(process.cwd(), templateFile);
  let template: string;
  try {
    template = readFileSync(templatePath, "utf-8");
  } catch (error) {
    throw new Error(`Failed to read ${templateFile} at ${templatePath}: ${error}`);
  }

  const entries: TemplateEntry[] = [];
  for (const rawLine of template.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, name, rawValue] = match;
    const value = rawValue.replace(/^["']|["']$/g, "");
    const opMatch = value.match(/^op:\/\/[^/]+\/[^/]+\/(.+)$/);
    entries.push({ name, opField: opMatch ? opMatch[1] : null });
  }
  return entries;
}

/** The set of env-var fields a template pulls from 1Password (op:// refs only). */
export function templateOpFieldNames(templateFile = ".env.tpl"): Set<string> {
  return new Set(
    parseTemplate(templateFile)
      .filter((e) => e.opField !== null)
      .map((e) => e.opField as string)
  );
}

/**
 * Env-var-shaped field labels for a 1Password item (e.g. "staging").
 * Reads labels only; secret values are never touched.
 */
export function fetchItemFieldNames(env: string): Set<string> {
  const itemName = `${ITEM_PREFIX} ${env}`;
  const result = spawnSync(
    "op",
    ["item", "get", itemName, "--vault", VAULT, "--format", "json"],
    { encoding: "utf-8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to read 1Password item "${itemName}": ${
        result.stderr?.substring(0, 300) || "unknown error"
      }`
    );
  }

  let parsed: { fields?: Array<{ label?: string }> };
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse 1Password response for "${itemName}": ${error}`);
  }

  const names = new Set<string>();
  for (const field of parsed.fields ?? []) {
    const label = field.label ?? "";
    if (ENV_NAME_RE.test(label)) names.add(label);
  }
  return names;
}

export interface FilterTemplateResult {
  /** Template text with unresolvable optional refs commented out. */
  filtered: string;
  /** Optional vars dropped because their field is absent from the item. */
  skipped: string[];
  /** Required vars whose field is absent — the caller must abort on these. */
  missingRequired: string[];
}

/**
 * Comment out template lines whose op:// field does not exist in the
 * 1Password item, so `op inject` succeeds with partially-populated items
 * (it hard-fails on ANY missing field). Optional vars are skipped and
 * reported; vars in `required` are returned separately so the caller can
 * fail instead of silently producing a broken env file.
 */
export function filterTemplateToItem(
  template: string,
  itemFields: Set<string>,
  required: Set<string>
): FilterTemplateResult {
  const skipped: string[] = [];
  const missingRequired: string[] = [];

  const lines = template.split("\n").map((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return rawLine;

    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) return rawLine;

    const [, name, rawValue] = match;
    const value = rawValue.replace(/^["']|["']$/g, "");
    const opMatch = value.match(/^op:\/\/[^/]+\/[^/]+\/(.+)$/);
    if (!opMatch || itemFields.has(opMatch[1])) return rawLine;

    if (required.has(name)) {
      missingRequired.push(name);
      return rawLine; // kept for the error message; caller aborts before inject
    }
    skipped.push(name);
    return `# ${name} skipped — no "${opMatch[1]}" field in the 1Password item`;
  });

  return { filtered: lines.join("\n"), skipped, missingRequired };
}
