/**
 * Check for drift between 1Password and the env templates.
 *
 * `.env.tpl` is the single source of truth for what syncs to Vercel
 * (sync-env-to-vercel.ts only uploads what it references) — checked against
 * the staging and production items. `.env.local.tpl` feeds `pnpm env:local`
 * (machine-local .env.local) — checked against the local item. A variable can
 * exist in 1Password yet never reach Vercel/dev because nobody added it to
 * the matching template; this script surfaces that gap.
 *
 * For each (template, 1Password item) pair it reports:
 *   - fields present in 1Password, absent from the template, and read by workflows
 *     → informational: keep these workflow-only fields out of the template
 *   - fields present in 1Password but referenced by neither template nor workflows
 *     → newly-set secrets you probably want to add to the template
 *   - OPTIONAL template refs whose field is MISSING from 1Password
 *     → advisory: the tolerant sync scripts skip these with a warning
 *   - REQUIRED template refs whose field is MISSING from 1Password
 *     → broken: the sync scripts refuse to run, and the app cannot boot
 *   - workflow refs whose field is MISSING from 1Password, with workflow filenames
 *     → broken: load-secrets-action fails the step
 *
 * Prints field NAMES only — never secret values.
 *
 * Usage:
 *   pnpm env:check
 *
 * Prerequisites: 1Password CLI authenticated (`op signin`).
 *
 * Exit code: 1 if a REQUIRED template ref or any workflow ref is missing from
 * 1Password; otherwise 0 (CI-usable).
 * Untracked-in-template and missing-optional findings are advisory and do not
 * fail the check on their own.
 */

import { spawnSync } from "child_process";
import {
  ITEM_PREFIX,
  REQUIRED_DEPLOYED_VARS,
  REQUIRED_LOCAL_VARS,
  VAULT,
  fetchItemFieldNames,
  parseTemplate,
  readWorkflowOpReferences,
  templateOpFieldNames,
} from "./env-tpl-utils";

/** Each 1Password item is reconciled against the template that consumes it. */
const CHECKS = [
  { env: "staging", templateFile: ".env.tpl", required: REQUIRED_DEPLOYED_VARS },
  { env: "production", templateFile: ".env.tpl", required: REQUIRED_DEPLOYED_VARS },
  { env: "local", templateFile: ".env.local.tpl", required: REQUIRED_LOCAL_VARS },
] as const;

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
  console.log("Checking drift between 1Password and the env templates\n");
  check1PasswordAuth();

  const workflowReferences = readWorkflowOpReferences();
  let hasBrokenRefs = false;
  let hasUntracked = false;

  for (const { env, templateFile, required } of CHECKS) {
    const template = parseTemplate(templateFile);
    const templateFields = templateOpFieldNames(templateFile);
    const literals = template.filter((e) => e.opField === null).map((e) => e.name);

    let itemFields: Set<string>;
    try {
      itemFields = fetchItemFieldNames(env);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    console.log(
      `── ${templateFile} (${template.length} vars` +
        `${literals.length ? `, ${literals.length} literal: ${literals.join(", ")}` : ""}) ` +
        `↔ 1Password item: ${ITEM_PREFIX} ${env} (${itemFields.size} fields) ──`
    );

    const workflowFields = workflowReferences.get(env) ?? new Map<string, Set<string>>();
    const outsideTemplate = [...itemFields].filter((n) => !templateFields.has(n)).sort();
    const workflowOnly = outsideTemplate.filter((n) => workflowFields.has(n));
    const untracked = outsideTemplate.filter((n) => !workflowFields.has(n));
    const missingWorkflow = [...workflowFields.keys()].filter((n) => !itemFields.has(n)).sort();
    const missing = [...templateFields].filter((n) => !itemFields.has(n)).sort();
    const missingOptional = missing.filter((n) => !required.has(n));
    const missingRequired = missing.filter((n) => required.has(n));

    if (workflowOnly.length > 0) {
      console.log(`  ℹ️  Read only by GitHub workflows (keep out of ${templateFile}):`);
      for (const name of workflowOnly) console.log(`        ${name}`);
    }
    if (untracked.length > 0) {
      hasUntracked = true;
      console.log(`  ⚠️  In 1Password but NOT in ${templateFile} (consider adding):`);
      for (const name of untracked) console.log(`        ${name}`);
    }
    if (missingOptional.length > 0) {
      console.log(
        `  ⚠️  In ${templateFile} but MISSING from 1Password (optional — sync skips with a warning):`
      );
      for (const name of missingOptional) console.log(`        ${name}`);
    }
    if (missingRequired.length > 0) {
      hasBrokenRefs = true;
      console.log(
        `  ❌  In ${templateFile} but MISSING from 1Password (REQUIRED — sync refuses to run):`
      );
      for (const name of missingRequired) console.log(`        ${name}`);
    }
    if (missingWorkflow.length > 0) {
      hasBrokenRefs = true;
      console.log(
        "  ❌  Referenced by GitHub workflows but MISSING from 1Password (load-secrets-action fails the step):"
      );
      for (const name of missingWorkflow) {
        console.log(`        ${name} (${[...workflowFields.get(name)!].join(", ")})`);
      }
    }
    if (untracked.length === 0 && missing.length === 0 && missingWorkflow.length === 0) {
      console.log("  ✅  In sync");
    }
    console.log("");
  }

  if (hasUntracked) {
    console.log(
      "Add any wanted variables to the matching template as:\n" +
        `  NAME="op://${VAULT}/${ITEM_PREFIX} <env>/NAME"\n` +
        "then run: pnpm env:vercel (.env.tpl) or pnpm env:local (.env.local.tpl)\n"
    );
  }

  if (hasBrokenRefs) {
    console.error(
      "Drift check failed: required template or GitHub workflow fields are missing from 1Password."
    );
    process.exit(1);
  }
  console.log("No broken required references.");
}

main();
