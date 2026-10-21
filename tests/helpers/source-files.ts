import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** `src/`, the root the coverage checks scan. */
const SRC = join(__dirname, "..", "..", "src");

/** Every non-test TypeScript source under `src/`, path relative to it. */
export function sourceFiles(): { path: string; text: string }[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter(file => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map(file => ({ path: relative(SRC, join(SRC, file)), text: readFileSync(join(SRC, file), "utf8") }));
}
