/**
 * Check for drift between 1Password and .env.tpl
 *
 * `.env.tpl` is the single source of truth for which variables get synced to
 * Vercel (see sync-env-to-vercel.ts — it only uploads what the template
 * references). A variable can therefore exist in 1Password yet never reach
 * Vercel because nobody added it to the template. This script surfaces that gap.
 *
 * For each 1Password item (staging + production) it reports:
 *   - fields present in 1Password but NOT referenced in .env.tpl
 *     → newly-set secrets you probably want to add to the template
 *   - .env.tpl op:// references whose field is MISSING from 1Password
 *     → broken references that will fail `op inject` during a sync
 *
 * Prints field NAMES only — never secret values.
 *
 * Usage:
 *   pnpm env:check
 *
 * Prerequisites: 1Password CLI authenticated (`op signin`).
 *
 * Exit code: 0 when no broken references; 1 when a template ref is missing from
 * 1Password (CI-usable). Fields-in-1Password-not-in-template are advisory and
 * do not fail the check on their own.
 */

import { spawnSync } from "child_process";
import {
  ITEM_PREFIX,
  VAULT,
  fetchItemFieldNames,
  parseTemplate,
  templateOpFieldNames,
} from "./env-tpl-utils";

const ENVS = ["staging", "production"] as const;

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
  console.log("Checking drift between 1Password and .env.tpl\n");
  check1PasswordAuth();

  const template = parseTemplate();
  const templateFields = templateOpFieldNames();
  const literals = template.filter((e) => e.opField === null).map((e) => e.name);

  console.log(
    `.env.tpl: ${template.length} variables ` +
      `(${templateFields.size} from 1Password, ${literals.length} literal${
        literals.length ? `: ${literals.join(", ")}` : ""
      })\n`
  );

  let hasBrokenRefs = false;
  let hasUntracked = false;

  for (const env of ENVS) {
    let itemFields: Set<string>;
    try {
      itemFields = fetchItemFieldNames(env);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    console.log(`── 1Password item: ${ITEM_PREFIX} ${env} (${itemFields.size} fields) ──`);

    const untracked = [...itemFields].filter((n) => !templateFields.has(n)).sort();
    const broken = [...templateFields].filter((n) => !itemFields.has(n)).sort();

    if (untracked.length > 0) {
      hasUntracked = true;
      console.log("  ⚠️  In 1Password but NOT in .env.tpl (consider adding):");
      for (const name of untracked) console.log(`        ${name}`);
    }
    if (broken.length > 0) {
      hasBrokenRefs = true;
      console.log("  ❌  In .env.tpl but MISSING from 1Password (broken ref):");
      for (const name of broken) console.log(`        ${name}`);
    }
    if (untracked.length === 0 && broken.length === 0) {
      console.log("  ✅  In sync");
    }
    console.log("");
  }

  if (hasUntracked) {
    console.log(
      "Add any wanted variables to .env.tpl as:\n" +
        `  NAME="op://${VAULT}/${ITEM_PREFIX} staging/NAME"\n` +
        "then run: pnpm env:vercel\n"
    );
  }

  if (hasBrokenRefs) {
    console.error("Drift check failed: .env.tpl references fields missing from 1Password.");
    process.exit(1);
  }
  console.log("No broken references.");
}

main();
