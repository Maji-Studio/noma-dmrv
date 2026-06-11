/**
 * Shared helpers for reconciling .env.tpl against the 1Password items it
 * references. Used by sync-env-to-vercel.ts (warns about untracked vars during
 * a sync) and check-env-drift.ts (standalone drift report).
 *
 * Never returns or logs secret values — field NAMES only.
 */

import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

export const VAULT = "Environment Variables";
export const ITEM_PREFIX = "noma-dmrv env";

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
