/**
 * Sync environment variables from 1Password to Vercel
 *
 * Reads environment variables from 1Password using the .env.tpl template
 * and uploads them to a Vercel project using the Vercel CLI.
 *
 * Usage:
 *   pnpm env:prod                   # Sync prod → production
 *   pnpm env:preview                # Sync prod → preview
 *   pnpm env:dev                    # Sync prod → development
 *   pnpm env:vercel                 # Sync all three environments
 *
 * Advanced:
 *   tsx scripts/sync-env-to-vercel.ts --1p-env=dev --vercel-env=development
 *   tsx scripts/sync-env-to-vercel.ts --dry-run --1p-env=prod
 *   tsx scripts/sync-env-to-vercel.ts --yes     # Skip confirmation (CI/CD)
 *
 * Prerequisites:
 *   1. 1Password CLI installed and authenticated (op signin)
 *   2. Vercel CLI installed (pnpm install)
 *   3. Vercel CLI authenticated (pnpm vercel login)
 *   4. Vercel project linked (pnpm vercel link)
 *   5. 1Password items exist:
 *      - op://Environment Variables/noma-dmrv env dev/...
 *      - op://Environment Variables/noma-dmrv env prod/...
 */

import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const ITEM_PREFIX = "noma-dmrv env";

// CLI flags
interface CliFlags {
  opEnv: string;
  vercelEnv: string;
  dryRun: boolean;
  yes: boolean;
  revealValues: boolean;
}

// Environment variable to sync
interface EnvVar {
  name: string;
  value: string;
  isSecret: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  let opEnv = "prod";
  let vercelEnv = "production";
  let dryRun = false;
  let yes = false;
  let revealValues = false;

  for (const arg of args) {
    if (arg.startsWith("--1p-env=")) {
      opEnv = arg.split("=")[1];
    } else if (arg.startsWith("--vercel-env=")) {
      vercelEnv = arg.split("=")[1];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--reveal-values") {
      revealValues = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  if (!["dev", "prod"].includes(opEnv)) {
    console.error(`Invalid --1p-env: ${opEnv} (must be dev or prod)`);
    process.exit(1);
  }

  if (!["production", "preview", "development"].includes(vercelEnv)) {
    console.error(
      `Invalid --vercel-env: ${vercelEnv} (must be production, preview, or development)`
    );
    process.exit(1);
  }

  return { opEnv, vercelEnv, dryRun, yes, revealValues };
}

function printUsage() {
  console.log(`
Sync environment variables from 1Password to Vercel

Usage:
  pnpm env:prod                    Sync prod -> production
  pnpm env:preview                 Sync prod -> preview
  pnpm env:dev                     Sync prod -> development
  pnpm env:vercel                  Sync all three environments

Advanced:
  tsx scripts/sync-env-to-vercel.ts --1p-env=dev --vercel-env=development
  tsx scripts/sync-env-to-vercel.ts --dry-run --1p-env=prod
  tsx scripts/sync-env-to-vercel.ts --yes    Skip confirmation (CI/CD)

Flags:
  --1p-env=<dev|prod>                          1Password item (default: prod)
  --vercel-env=<production|preview|development>  Vercel environment (default: production)
  --dry-run                                    Preview changes without applying
  --yes, -y                                    Skip confirmation prompt
  --reveal-values                              Show cleartext values for NEXT_PUBLIC_* vars
  --help, -h                                   Show this help message
`);
}

function check1PasswordAuth(): void {
  const result = spawnSync("op", ["whoami"], { encoding: "utf-8" });

  if (result.error) {
    console.error("1Password CLI not found");
    console.error("\nInstall with: brew install --cask 1password-cli");
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("Not authenticated with 1Password");
    console.error("\nRun: op signin");
    process.exit(1);
  }

  console.log("  1Password CLI authenticated");
}

function checkVercelAuth(): void {
  const result = spawnSync("vercel", ["whoami"], { encoding: "utf-8" });

  if (result.error) {
    console.error("Vercel CLI not found");
    console.error("\nInstall with: pnpm add -g vercel");
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("Not authenticated with Vercel");
    console.error("\nRun: vercel login");
    process.exit(1);
  }

  console.log("  Vercel CLI authenticated");
}

function checkVercelProject(): void {
  const result = spawnSync("test", ["-d", ".vercel"], { encoding: "utf-8" });

  if (result.status !== 0) {
    console.error("Vercel project not linked");
    console.error("\nRun: vercel link");
    process.exit(1);
  }

  console.log("  Vercel project linked");
}

function fetchFromOnePassword(opEnv: string): Map<string, string> {
  const itemName = `${ITEM_PREFIX} ${opEnv}`;
  console.log(`\nFetching from 1Password (${itemName})...`);

  const templatePath = join(process.cwd(), ".env.tpl");
  let template: string;

  try {
    template = readFileSync(templatePath, "utf-8");
  } catch {
    console.error("Failed to read .env.tpl");
    process.exit(1);
  }

  // Replace the default "dev" environment with the requested one
  const modifiedTemplate = template.replace(
    new RegExp(`${ITEM_PREFIX} (dev|\\{\\{ENV\\}\\})`, "g"),
    itemName
  );

  if (!modifiedTemplate.trim()) {
    console.error("Template is empty after modification");
    process.exit(1);
  }

  // Write to temp file for op inject
  const tempFile = join(tmpdir(), `noma-dmrv-env-${Date.now()}.tpl`);
  try {
    writeFileSync(tempFile, modifiedTemplate, "utf-8");

    const result = spawnSync("bash", ["-c", `cat "${tempFile}" | op inject`], {
      encoding: "utf-8",
    });

    unlinkSync(tempFile);

    if (result.status !== 0) {
      console.error("Failed to fetch from 1Password");
      console.error("stderr:", result.stderr?.substring(0, 500) || "No stderr");
      process.exit(1);
    }

    const envVars = new Map<string, string>();
    const lines = result.stdout.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        const cleanValue = value.replace(/^["']|["']$/g, "");
        envVars.set(key, cleanValue);
      }
    }

    console.log(`Fetched ${envVars.size} variables from 1Password`);
    return envVars;
  } catch (error) {
    try {
      unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    console.error(`Failed to process template: ${error}`);
    process.exit(1);
  }
}

function isPublic(name: string): boolean {
  return name.startsWith("NEXT_PUBLIC_") || name === "NODE_ENV";
}

function uploadToVercel(
  envVars: Map<string, string>,
  vercelEnv: string,
  dryRun: boolean,
  yes: boolean,
  revealValues: boolean
): void {
  console.log(
    `\n${dryRun ? "Preview" : "Syncing"} to Vercel (${vercelEnv})...`
  );

  const varsToSync: EnvVar[] = [];
  for (const [name, value] of envVars) {
    if (name === "NODE_ENV") {
      console.log(`  Skipping NODE_ENV (environment-specific)`);
      continue;
    }

    varsToSync.push({
      name,
      value,
      isSecret: !isPublic(name),
    });
  }

  if (varsToSync.length === 0) {
    console.error("No variables to sync");
    process.exit(1);
  }

  console.log(`\nVariables to sync (${varsToSync.length}):`);
  for (const { name, value, isSecret: secret } of varsToSync) {
    const showCleartext = (!secret && revealValues) || isPublic(name);
    const displayValue = showCleartext ? value.substring(0, 50) : "***";
    const truncated = showCleartext && value.length > 50 ? "..." : "";
    console.log(`  ${name} = ${displayValue}${truncated}`);
  }

  if (dryRun) {
    console.log("\nDry-run complete (no changes made)");
    return;
  }

  console.log(
    `\nThis will overwrite existing variables in Vercel ${vercelEnv} environment`
  );

  if (yes) {
    console.log("Auto-confirming (--yes flag)");
    performSync(varsToSync, vercelEnv);
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(
      "Not running in interactive terminal and --yes flag not provided"
    );
    console.error(
      "Run with --yes flag to skip confirmation in CI/CD environments"
    );
    process.exit(1);
  }

  console.log("Press Ctrl+C to cancel, or Enter to continue...");

  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf-8");

  stdin.once("data", (key: string) => {
    stdin.setRawMode(false);
    stdin.pause();

    if (key === "\u0003") {
      console.log("\nCancelled by user");
      process.exit(0);
    }

    performSync(varsToSync, vercelEnv);
  });
}

function performSync(varsToSync: EnvVar[], vercelEnv: string): void {
  console.log("\nUploading to Vercel...\n");

  let successCount = 0;
  let errorCount = 0;
  const errors: Array<{ name: string; error: string }> = [];

  for (const { name, value } of varsToSync) {
    const result = spawnSync(
      "vercel",
      ["env", "add", name, vercelEnv, "--force"],
      {
        input: value,
        encoding: "utf-8",
      }
    );

    if (result.status === 0) {
      console.log(`  ${name} -> ${vercelEnv}`);
      successCount++;
    } else {
      console.error(`  FAILED ${name} -> ${vercelEnv}`);
      errorCount++;
      errors.push({
        name,
        error: result.stderr || result.error?.message || "Unknown error",
      });
    }
  }

  console.log("\n---");
  console.log(`${successCount} variables synced successfully`);
  if (errorCount > 0) {
    console.log(`${errorCount} variables failed`);
  }
  console.log("---");

  if (errors.length > 0) {
    console.log("\nErrors:");
    for (const { name, error } of errors) {
      console.error(`  ${name}: ${error}`);
    }
  }

  if (errorCount > 0) {
    console.error("\nSync completed with errors");
    process.exit(1);
  } else {
    console.log("\nAll variables synced successfully!");
  }
}

async function main() {
  console.log("Syncing environment variables from 1Password to Vercel\n");

  const flags = parseFlags();

  console.log("Configuration:");
  console.log(`  1Password item: ${ITEM_PREFIX} ${flags.opEnv}`);
  console.log(`  Vercel environment: ${flags.vercelEnv}`);
  console.log(`  Dry-run: ${flags.dryRun ? "yes" : "no"}`);

  console.log("\nChecking prerequisites...");

  check1PasswordAuth();
  checkVercelAuth();
  checkVercelProject();

  console.log("All prerequisites met");

  const envVars = fetchFromOnePassword(flags.opEnv);

  uploadToVercel(
    envVars,
    flags.vercelEnv,
    flags.dryRun,
    flags.yes,
    flags.revealValues
  );
}

main().catch((error) => {
  console.error("\nUnexpected error:", error);
  process.exit(1);
});
