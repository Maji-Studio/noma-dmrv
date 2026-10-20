/** Regenerate branch migrations offline from origin/staging's metadata. */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkStagingCollisions,
  readStagingJournal,
  type MigrationEntry,
} from "./check-migrations";
import { planRenumber } from "./migration-renumber";

const EXIT_FAILURE = 1;
const CLI_ARGUMENTS_START = 2;
const SINGLE_MIGRATION_COUNT = 1;
const OFFLINE_DATABASE_URL = "postgresql://offline.invalid/none";
const SAFE_MIGRATION_TAG = /^[\w-]+$/;
const BACKUP_ROOT = "node_modules/.cache/db-renumber";

function printFollowUp(): void {
  console.log("Review the generated SQL and re-apply any hand-written SQL from the backups.");
  console.log("For worktrees: scripts/worktree.sh migrate <name> (being added in PR #1289).");
  console.log("Guarded fallback available today: reset and migrate both worktree DBs only (see docs/testing.md):");
  console.log("  DATABASE_URL=<dev url> pnpm db:reset");
  console.log("  DATABASE_URL=<test url> pnpm db:reset");
  console.log("A plain migrate skips staging's migration when its journal when is older than the newest applied one.");
}

function main(): void {
  let backupDirectory: string | undefined;
  try {
    const args = process.argv.slice(CLI_ARGUMENTS_START);
    if (args.some((arg) => arg !== "--dry-run")) {
      throw new Error("Usage: pnpm db:renumber [--dry-run]");
    }
    const dryRun = args.includes("--dry-run");
    const directory = join(process.cwd(), "drizzle");
    const metadata = join(directory, "meta");
    const branch: { entries: MigrationEntry[] } = JSON.parse(
      readFileSync(join(metadata, "_journal.json"), "utf8"),
    );
    const staging = readStagingJournal();
    if (!staging) throw new Error("Staging journal unavailable. Run git fetch origin staging and retry.");
    const { branchOnly, name, nextTag } = planRenumber(staging, branch.entries);
    if (name === undefined || nextTag === undefined) {
      console.log("Nothing to renumber.");
      return;
    }
    const branchTags = new Set(branch.entries.map((entry) => entry.tag));
    const missingStaging = staging.some((entry) => !branchTags.has(entry.tag));
    if (checkStagingCollisions(branch.entries, staging).length === 0 && !missingStaging) {
      console.log("No collision with staging.");
      return;
    }

    const dirtyMigrations = execFileSync("git", [
      "status", "--porcelain", "--untracked-files=all", "--ignored=matching", "--", "drizzle/",
    ], { encoding: "utf8" });
    if (dirtyMigrations.trim()) {
      throw new Error("Commit or stash changes under drizzle/ before renumbering. Unrelated working tree edits are allowed.");
    }
    if (branchOnly.some((tag) => !SAFE_MIGRATION_TAG.test(tag))) {
      throw new Error("Branch migration tags must contain only letters, digits, underscores or hyphens.");
    }
    console.log("Reminder: merge origin/staging's schema code before running this command. This cannot be verified automatically.");
    console.log(`Regenerate ${branchOnly.join(", ")} as ${nextTag} with a fresh journal timestamp.`);
    console.log(`Back up branch SQL and metadata to ${BACKUP_ROOT}/<timestamp>/ before replacing files.`);
    for (const tag of branchOnly) console.log(`Remove drizzle/${tag}.sql`);
    console.log("Replace all of drizzle/meta/ with origin/staging's journal and snapshots.");
    console.log(`Generate drizzle/${nextTag}.sql and its journal entry and snapshot in drizzle/meta/.`);
    if (dryRun) {
      console.log("Dry run: no files changed.");
      printFollowUp();
      return;
    }

    mkdirSync(BACKUP_ROOT, { recursive: true });
    backupDirectory = mkdtempSync(join(BACKUP_ROOT, `${Date.now()}-`));
    for (const tag of branchOnly) {
      cpSync(join(directory, `${tag}.sql`), join(backupDirectory, `${tag}.sql`));
    }
    cpSync(metadata, join(backupDirectory, "meta"), { recursive: true });
    console.log(`Backups saved to ${backupDirectory}`);
    for (const tag of branchOnly) rmSync(join(directory, `${tag}.sql`));
    // Removing the whole directory prevents branch-only snapshots surviving checkout.
    rmSync(metadata, { recursive: true });
    execFileSync("git", ["checkout", "origin/staging", "--", "drizzle/meta"], { stdio: "inherit" });
    const generate = (extra: string[]): void => {
      execFileSync("pnpm", ["exec", "drizzle-kit", "generate", ...extra, "--name", name], {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: OFFLINE_DATABASE_URL },
      });
    };
    generate([]);

    const generatedFile = join(directory, `${nextTag}.sql`);
    const previousSql = readFileSync(join(backupDirectory, `${branchOnly.at(-1)!}.sql`));
    if (!existsSync(generatedFile)) {
      // No schema diff: the branch migration was hand-written SQL only (triggers, functions, data).
      generate(["--custom"]);
      writeFileSync(generatedFile, previousSql);
      console.log("No schema changes found; kept the hand-written SQL as a custom migration.");
    } else if (readFileSync(generatedFile).equals(previousSql)) {
      console.log("Generated SQL is identical to the last branch migration's backed-up SQL.");
    } else {
      console.warn(`WARNING: Generated SQL differs from the last branch migration. Re-apply hand-written SQL from ${backupDirectory}.`);
    }
    if (branchOnly.length > SINGLE_MIGRATION_COUNT) {
      console.warn(`Collapsed ${branchOnly.length} branch migrations into one. Review all SQL backups in ${backupDirectory}.`);
    }
    printFollowUp();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Migration renumbering failed.");
    if (backupDirectory) {
      console.error(`Renumbering did not finish. Original SQL and metadata backups are in ${backupDirectory}; restore or review them before retrying.`);
    }
    process.exitCode = EXIT_FAILURE;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
