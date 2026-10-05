/**
 * Guard against `var(--x)` references to custom properties nothing defines.
 *
 * An undefined custom property makes the declaration invalid at computed-value
 * time, so the property falls back to its initial value: a background turns
 * transparent, a width collapses. Tailwind, `tsc` and ESLint all see a valid
 * string. Renamed tokens are the usual cause (see the token trap in
 * docs/design-system.md).
 *
 * The app (`src/`) and the marketing site (`site/src/`) are checked as
 * separate scopes, because the site never loads `src/app/globals.css`.
 *
 * Like `check-spacing-scale.ts` this is a heuristic, not a parser. A property
 * counts as defined when any file in its scope declares it in CSS (`--x:`,
 * including `@theme` and scoped rules), writes it in an inline style string or
 * style-object key (`"--x":`), or passes it to `setProperty("--x", …)`. A use
 * with a fallback (`var(--x, 4px)`) is skipped: it is optional by design. An
 * interpolated name (`var(--tone-${t})`) passes when some definition starts
 * with its static prefix.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const SCOPES = [
  { name: "app", dir: "src", extensions: [".ts", ".tsx", ".css", ".js", ".mjs"] },
  { name: "site", dir: "site/src", extensions: [".astro", ".ts", ".js", ".mjs", ".css"] },
];
const SKIPPED_DIRS = new Set(["node_modules", "generated"]);
/** Same reason as the spacing check: tests may assert on broken references. */
const TEST_FILE = /\.test\.[jt]sx?$/;

/**
 * Properties set by libraries at runtime, which no file here declares.
 * Base UI positioners expose the anchor/available sizes and transform origin;
 * Tailwind's own utilities read and write `--tw-*`.
 */
const LIBRARY_PROPERTIES = new Set([
  "--anchor-width",
  "--anchor-height",
  "--available-width",
  "--available-height",
  "--transform-origin",
]);
const LIBRARY_PREFIXES = ["--tw-"];

const NAME = "--[A-Za-z0-9_-]+";
/** `--x:` not preceded by a name character, so `var(--x)` never matches. */
const CSS_DECLARATION = new RegExp(`(?<![\\w-])(${NAME})\\s*:`, "g");
/** A quoted style-object key: `"--x": v` or `["--x" as string]: v`. */
const STYLE_KEY = new RegExp(`["'\`](${NAME})["'\`]\\s*(?:as\\s+\\w+\\s*)?\\]?\\s*:`, "g");
/** A runtime write. Reads (`getPropertyValue`, `removeProperty`) define nothing. */
const SET_PROPERTY = new RegExp(`setProperty\\(\\s*["'\`](${NAME})["'\`]`, "g");
/** `var(--x` with what follows it: `,` (fallback), `$` (interpolation) or `)`. */
const VAR_USE = new RegExp(`var\\(\\s*(${NAME})\\s*([,)$]?)`, "g");
/** Tailwind v4 shorthand: `p-(--x)` reads `var(--x)`. */
const TAILWIND_SHORTHAND_USE = new RegExp(`[a-z]-\\((${NAME})\\)`, "g");

export interface CssVarUse {
  name: string;
  line: number;
  /** The name continues with `${…}`; only its static prefix is known. */
  dynamic: boolean;
}

export function extractDefinitions(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(CSS_DECLARATION)) names.add(match[1]);
  for (const match of text.matchAll(STYLE_KEY)) names.add(match[1]);
  for (const match of text.matchAll(SET_PROPERTY)) names.add(match[1]);
  return names;
}

export function extractUses(text: string): CssVarUse[] {
  const uses: CssVarUse[] = [];
  text.split("\n").forEach((lineText, index) => {
    const line = index + 1;
    for (const [, name, next] of lineText.matchAll(VAR_USE)) {
      if (next === ",") continue;
      uses.push({ name, line, dynamic: next === "$" });
    }
    for (const [, name] of lineText.matchAll(TAILWIND_SHORTHAND_USE)) {
      uses.push({ name, line, dynamic: false });
    }
  });
  return uses;
}

function isDefined(use: CssVarUse, defined: Set<string>): boolean {
  if (LIBRARY_PROPERTIES.has(use.name)) return true;
  if (LIBRARY_PREFIXES.some((prefix) => use.name.startsWith(prefix))) return true;
  if (!use.dynamic) return defined.has(use.name);
  for (const name of defined) if (name.startsWith(use.name)) return true;
  return false;
}

export function findUndefinedUses(uses: CssVarUse[], defined: Set<string>): CssVarUse[] {
  return uses.filter((use) => !isDefined(use, defined));
}

function walkSourceFiles(directory: string, extensions: string[]): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : walkSourceFiles(path, extensions);
    }
    return extensions.includes(extname(entry.name)) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

function main(): void {
  const failures: string[] = [];
  let useCount = 0;

  for (const scope of SCOPES) {
    const files = walkSourceFiles(join(ROOT, scope.dir), scope.extensions).map((path) => ({
      path,
      text: readFileSync(path, "utf8"),
    }));
    const defined = new Set(files.flatMap(({ text }) => [...extractDefinitions(text)]));
    for (const { path, text } of files) {
      const uses = extractUses(text);
      useCount += uses.length;
      for (const use of findUndefinedUses(uses, defined)) {
        const name = use.dynamic ? `${use.name}\${…}` : use.name;
        failures.push(`  [${scope.name}] ${relative(ROOT, path)}:${use.line}  ${name}`);
      }
    }
  }

  if (failures.length === 0) {
    console.log(`check:css-vars: ${useCount} var() references, all defined.`);
    return;
  }
  console.error(
    `${failures.length} var() reference(s) to custom properties defined nowhere in their scope:\n` +
      `${failures.join("\n")}\n\n` +
      "Define the property, fix the name, give the use a fallback, or (for a property a " +
      "library sets at runtime) add it to LIBRARY_PROPERTIES in scripts/check-css-vars.ts.",
  );
  process.exitCode = 1;
}

if (process.argv[1]?.includes("check-css-vars")) main();
