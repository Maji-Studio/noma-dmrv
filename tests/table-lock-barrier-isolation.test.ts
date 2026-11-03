import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";
import { TABLE_LOCK_BARRIER_FILES } from "./helpers/table-lock-barrier-files";

const ROOT = resolve(import.meta.dirname, "..");
const TEST_FILE = /\.test\.tsx?$/;
const TABLE_LOCK = /\block\s+table\b/i;

function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.isFile() && TEST_FILE.test(path) ? [path] : [];
  });
}

const filesWithTableLocks = new Set(
  ["src", "tests"].flatMap(directory => testFiles(join(ROOT, directory)))
    .filter(path => TABLE_LOCK.test(readFileSync(path, "utf8")))
    .map(path => relative(ROOT, path).replaceAll("\\", "/")),
);
const listedFiles = new Set(TABLE_LOCK_BARRIER_FILES);

it("isolates every test file that takes a table-level lock", () => {
  expect(
    [...filesWithTableLocks].filter(file => !listedFiles.has(file)),
    "Add these files to TABLE_LOCK_BARRIER_FILES so they run in isolation",
  ).toEqual([]);
});

it("keeps the table-level lock isolation list free of stale entries", () => {
  expect(
    TABLE_LOCK_BARRIER_FILES.filter(file => !filesWithTableLocks.has(file)),
    "These listed files no longer contain a table-level lock",
  ).toEqual([]);
});
