/**
 * Tolerant `pnpm env:local` — injects .env.local.tpl from the 1Password
 * "noma-dmrv env local" item into .env.local.
 *
 * Raw `op inject` hard-fails when the item lacks ANY referenced field, even
 * for variables that are optional in src/config/env.ts (geo keys, storage
 * signing secret, Isometric allowlists, …). This wrapper checks the item's
 * field names first, comments out unresolvable OPTIONAL references (with a
 * per-var warning), and only fails when a REQUIRED_LOCAL_VARS field is
 * missing — those would produce an .env.local the app cannot boot from.
 *
 * Prints field NAMES only — never secret values. `pnpm env:check` reports the
 * same gaps as a standalone drift check.
 *
 * Usage:
 *   pnpm env:local
 *
 * Prerequisites: 1Password CLI authenticated (`op signin`).
 */

import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ITEM_PREFIX,
  REQUIRED_LOCAL_VARS,
  fetchItemFieldNames,
  filterTemplateToItem,
} from "./env-tpl-utils";

const TEMPLATE_FILE = ".env.local.tpl";
const OUTPUT_FILE = ".env.local";
const OP_ENV = "local";

function check1PasswordAuth(): void {
  const result = spawnSync("op", ["whoami"], { encoding: "utf-8" });
  if (result.error) {
    console.error("1Password CLI not found — install with: brew install --cask 1password-cli");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("Not authenticated with 1Password — run: op signin");
    process.exit(1);
  }
}

function main(): void {
  check1PasswordAuth();

  let template: string;
  try {
    template = readFileSync(join(process.cwd(), TEMPLATE_FILE), "utf-8");
  } catch (error) {
    console.error(`Failed to read ${TEMPLATE_FILE}: ${error}`);
    process.exit(1);
  }

  let itemFields: Set<string>;
  try {
    itemFields = fetchItemFieldNames(OP_ENV);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const { filtered, skipped, missingRequired } = filterTemplateToItem(
    template,
    itemFields,
    REQUIRED_LOCAL_VARS
  );

  if (missingRequired.length > 0) {
    console.error(
      `Required field(s) missing from 1Password item "${ITEM_PREFIX} ${OP_ENV}": ` +
        missingRequired.join(", ")
    );
    console.error("Add them to the item, then rerun: pnpm env:local");
    process.exit(1);
  }

  // op inject still resolves the secrets; the temp file holds only op:// refs.
  const tempFile = join(tmpdir(), `noma-dmrv-env-local-${process.pid}.tpl`);
  try {
    writeFileSync(tempFile, filtered, "utf-8");
    const result = spawnSync(
      "op",
      ["inject", "-f", "-i", tempFile, "-o", OUTPUT_FILE],
      { stdio: "inherit" }
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  } finally {
    try {
      unlinkSync(tempFile);
    } catch {
      // already gone
    }
  }

  if (skipped.length > 0) {
    console.warn(
      `\n⚠️  Skipped ${skipped.length} optional variable(s) — no matching field in ` +
        `"${ITEM_PREFIX} ${OP_ENV}":`
    );
    for (const name of skipped) console.warn(`     ${name}`);
    console.warn(
      "   The app degrades gracefully without these. To include one, add the field\n" +
        "   to the 1Password item and rerun pnpm env:local (pnpm env:check shows drift)."
    );
  }
  console.log(`\nWrote ${OUTPUT_FILE} from ${TEMPLATE_FILE} ("${ITEM_PREFIX} ${OP_ENV}").`);
}

main();
