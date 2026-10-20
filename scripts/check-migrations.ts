/** Check migration file/journal consistency without connecting to a database. */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_FILE = /^(\d{4})_.*\.sql$/;
export const TAG_PREFIX = /^(\d{4})_/;
export const MIGRATION_PREFIX_WIDTH = 4;
// Preserve only the existing idx 9 -> 10 inversion; new timestamps must increase.
export const HISTORIC_TIMESTAMP_INVERSION = {
  previousIdx: 9,
  idx: 10,
  previousWhen: 1775491200000,
  when: 1775474419206,
};

export interface MigrationEntry {
  idx: number;
  tag: string;
  when: number;
}

export function checkStagingCollisions(
  entries: readonly MigrationEntry[],
  stagingEntries: readonly MigrationEntry[],
): string[] {
  const stagingTags = new Set(stagingEntries.map((entry) => entry.tag));
  const stagingPrefixes = new Map(stagingEntries.map((entry) => [entry.tag.match(TAG_PREFIX)?.[1], entry.tag]));
  const failures: string[] = [];
  for (const entry of entries) {
    if (stagingTags.has(entry.tag)) continue;
    const prefix = entry.tag.match(TAG_PREFIX)?.[1];
    const stagingTag = prefix === undefined ? undefined : stagingPrefixes.get(prefix);
    if (stagingTag) {
      failures.push(`${prefix} already exists on staging as ${stagingTag}. Run pnpm db:renumber`);
    }
  }
  return failures;
}

export function readStagingJournal(): MigrationEntry[] | undefined {
  try {
    const journal: { entries: MigrationEntry[] } = JSON.parse(execFileSync(
      "git", ["show", "origin/staging:drizzle/meta/_journal.json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ));
    if (!Array.isArray(journal.entries)) throw new Error("Invalid staging journal");
    return journal.entries;
  } catch {
    console.warn("Warning: origin/staging migration journal unavailable; skipping staging comparison.");
    return undefined;
  }
}

export function checkMigrations(
  entries: readonly MigrationEntry[],
  files: readonly string[],
  stagingEntries?: readonly MigrationEntry[],
): string[] {
  const failures: string[] = [];
  const fileNames = new Set(files);
  const tags = new Set(entries.map((entry) => entry.tag));
  const prefixes = new Map<string, string>();
  let latest: MigrationEntry | undefined;

  entries.forEach((entry, index) => {
    if (entry.idx !== index) {
      failures.push(`Journal entry ${index} has idx ${entry.idx}; expected ${index}.`);
    }
    if (!fileNames.has(`${entry.tag}.sql`)) {
      failures.push(`Journal entry ${entry.idx} is missing drizzle/${entry.tag}.sql.`);
    }
    const prefix = entry.tag.match(TAG_PREFIX)?.[1];
    if (prefix === undefined || Number(prefix) !== entry.idx) {
      failures.push(`Journal tag ${entry.tag} has a numeric prefix different from idx ${entry.idx}.`);
    }
    const previous = entries[index - 1];
    const historicInversion = previous?.idx === HISTORIC_TIMESTAMP_INVERSION.previousIdx &&
      entry.idx === HISTORIC_TIMESTAMP_INVERSION.idx &&
      previous.when === HISTORIC_TIMESTAMP_INVERSION.previousWhen &&
      entry.when === HISTORIC_TIMESTAMP_INVERSION.when;
    // Drizzle skips a migration older than the newest one applied, not just its neighbour.
    if (latest && !(entry.when > latest.when) && !historicInversion) {
      failures.push(`Journal entry ${entry.idx} when ${entry.when} must be greater than entry ${latest.idx} when ${latest.when}.`);
    }
    if (!latest || entry.when > latest.when) latest = entry;
  });

  for (const file of files) {
    if (!file.endsWith(".sql")) continue;
    if (!tags.has(file.slice(0, -".sql".length))) {
      failures.push(`drizzle/${file} has no journal entry.`);
    }
    const prefix = file.match(MIGRATION_FILE)?.[1];
    if (prefix === undefined) continue;
    const existing = prefixes.get(prefix);
    if (existing) {
      failures.push(`Migration prefix ${prefix} is shared by ${existing} and ${file}.`);
    } else {
      prefixes.set(prefix, file);
    }
  }
  if (stagingEntries) failures.push(...checkStagingCollisions(entries, stagingEntries));
  return failures;
}

function main(): void {
  const directory = join(process.cwd(), "drizzle");
  const journal: { entries: MigrationEntry[] } = JSON.parse(
    readFileSync(join(directory, "meta/_journal.json"), "utf8"),
  );
  const failures = checkMigrations(journal.entries, readdirSync(directory).sort(), readStagingJournal());
  if (failures.length === 0) {
    console.log(`check:migrations: ${journal.entries.length} entries, all consistent.`);
    return;
  }
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
