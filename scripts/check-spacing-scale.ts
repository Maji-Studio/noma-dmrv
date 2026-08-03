/**
 * Guard against Tailwind spacing utilities that resolve to nothing.
 *
 * `@theme inline` in `src/app/globals.css` sets `--spacing-*: initial`, which
 * DELETES the default Tailwind spacing scale rather than remapping it. Only the
 * `--spacing-<n>` values declared there generate utilities. Every other number
 * — `size-44`, `gap-3`, `w-120` — compiles to no rule at all, with no warning
 * from Tailwind, from `tsc`, or from ESLint. The element simply has no size.
 *
 * That is worst on touch targets: `size-44` was the 44px minimum on six
 * controls, all of which rendered at icon size instead. The fix is an arbitrary
 * value (`size-[44px]`) or the nearest real step.
 *
 * The check is a heuristic, not a parser, in the same spirit as
 * `check-org-scoping.ts`: it reads string literals (which is where class lists
 * live), tokenises them on whitespace, strips variant prefixes such as `md:` or
 * `group-hover:`, and flags a spacing-prefixed utility whose value is a bare
 * integer that is not on the scale. Fractions (`w-1/2`), keywords (`w-full`),
 * and arbitrary values (`size-[44px]`) are all left alone.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const SCANNED_DIR = join(ROOT, "src");
const THEME_FILE = join(ROOT, "src/app/globals.css");
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);
/**
 * Colocated tests are skipped. A test asserting `expect(html).not.toContain(
 * "w-120")` is guarding against exactly this bug, and flagging it would make
 * the check argue with its own regression coverage.
 */
const TEST_FILE = /\.test\.tsx?$/;

/**
 * Utility prefixes whose bare-number value comes from `--spacing-*`. Ordered
 * longest-first at match time so `gap-x` wins over `gap`.
 *
 * Deliberately excluded: `border`, `z`, `opacity`, `order`, `flex`, `grow`,
 * `shrink`, `col-span`, `row-span`, `grid-cols`, `line-clamp`. Each has its own
 * numeric scale that survives the `--spacing-*: initial` reset, so a number
 * there is not evidence of anything.
 */
const SPACING_PREFIXES = [
  "p", "px", "py", "pt", "pr", "pb", "pl", "ps", "pe",
  "m", "mx", "my", "mt", "mr", "mb", "ml", "ms", "me",
  "gap", "gap-x", "gap-y",
  "space-x", "space-y",
  "w", "h", "size",
  "min-w", "min-h", "max-w", "max-h",
  "inset", "inset-x", "inset-y",
  "top", "right", "bottom", "left", "start", "end",
  // Less obvious members of the same namespace. `basis-3` compiles to nothing
  // here exactly like `gap-3` does; leaving them out made the gate look
  // thorough while quietly permitting the same bug.
  "basis",
  "translate", "translate-x", "translate-y", "translate-z",
  "scroll-m", "scroll-mx", "scroll-my",
  "scroll-mt", "scroll-mr", "scroll-mb", "scroll-ml",
  "scroll-p", "scroll-px", "scroll-py",
  "scroll-pt", "scroll-pr", "scroll-pb", "scroll-pl",
  "indent",
  "border-spacing", "border-spacing-x", "border-spacing-y",
  "leading",
];

/** Longest first, so `min-w` is tested before `m` and `gap-x` before `gap`. */
const PREFIXES_BY_LENGTH = [...SPACING_PREFIXES].sort(
  (a, b) => b.length - a.length,
);

/** A single- double- or backtick-quoted literal, escapes included. */
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

interface Violation {
  file: string;
  line: number;
  utility: string;
  suggestion: string;
}

function loadSpacingScale(): Set<string> {
  const css = readFileSync(THEME_FILE, "utf8");
  const scale = new Set<string>();
  for (const match of css.matchAll(/--spacing-(\d+):/g)) {
    scale.add(match[1]!);
  }
  if (scale.size === 0) {
    throw new Error(
      `No --spacing-<n> tokens found in ${relative(ROOT, THEME_FILE)}. ` +
        "The scale moved; update check-spacing-scale.ts.",
    );
  }
  return scale;
}

function walkSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(path);
    if (TEST_FILE.test(entry.name)) return [];
    return SCANNED_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

/**
 * The off-scale value's nearest legal neighbours, so the message says what to
 * write instead rather than only what is wrong.
 */
function suggest(prefix: string, value: number, scale: Set<string>): string {
  const steps = [...scale].map(Number).sort((a, b) => a - b);
  const nearest = steps.reduce((best, step) =>
    Math.abs(step - value) < Math.abs(best - value) ? step : best,
  );
  return `use ${prefix}-[${value}px] to keep ${value}px, or ${prefix}-${nearest} to snap to the scale`;
}

/**
 * The spacing prefix and bare integer in a class token, if it has both.
 * Exported for `tests/check-spacing-scale.test.ts` — this parser is the whole
 * gate, and a gate nobody tests is a gate that quietly stops catching things.
 */
export function parseUtility(
  token: string,
): { prefix: string; value: number } | null {
  // Drop variants: `md:`, `hover:`, `group-hover:`, `dark:md:`.
  const bare = token.slice(token.lastIndexOf(":") + 1);
  // Both important forms are valid Tailwind and both compile to nothing when
  // the value is off-scale, so neither may slip past: `!p-3` and `p-3!`.
  const unmarked = bare.replace(/^!/, "").replace(/!$/, "");
  // A leading `-` is a negative utility (`-mt-16`); the scale check is the same.
  const unsigned = unmarked.startsWith("-") ? unmarked.slice(1) : unmarked;

  for (const prefix of PREFIXES_BY_LENGTH) {
    if (!unsigned.startsWith(`${prefix}-`)) continue;
    const value = unsigned.slice(prefix.length + 1);
    // Bare integers only: keywords, fractions, arbitrary values and CSS
    // variables are not on the numeric scale and are not this check's business.
    if (!/^\d+$/.test(value)) return null;
    return { prefix, value: Number(value) };
  }
  return null;
}

function findViolations(scale: Set<string>): Violation[] {
  const violations: Violation[] = [];

  for (const file of walkSourceFiles(SCANNED_DIR)) {
    const source = readFileSync(file, "utf8");
    const seen = new Set<string>();

    for (const literal of source.matchAll(STRING_LITERAL)) {
      const body = literal[0].slice(1, -1);
      // A class list is whitespace-separated; anything else tokenises into
      // words that will not match a prefix.
      for (const token of body.split(/\s+/)) {
        const parsed = parseUtility(token);
        if (!parsed || scale.has(String(parsed.value))) continue;

        const line = source.slice(0, literal.index).split("\n").length;
        const key = `${line}:${token}`;
        if (seen.has(key)) continue;
        seen.add(key);

        violations.push({
          file: relative(ROOT, file),
          line,
          utility: token,
          suggestion: suggest(parsed.prefix, parsed.value, scale),
        });
      }
    }
  }

  return violations;
}

function main(): void {
  const scale = loadSpacingScale();
  const violations = findViolations(scale);

  if (violations.length === 0) {
    console.log(
      `check:spacing-scale — no off-scale spacing utilities (scale: ${[...scale]
        .map(Number)
        .sort((a, b) => a - b)
        .join(" ")}).`,
    );
    return;
  }

  console.error(
    `check:spacing-scale — ${violations.length} utility/utilities resolve to no CSS:\n`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line}  ${violation.utility}\n` +
        `      ${violation.suggestion}`,
    );
  }
  console.error(
    "\nThe spacing scale is 1px per unit and is an allow-list: `--spacing-*: initial`\n" +
      "in src/app/globals.css deletes every value it does not declare.",
  );
  process.exitCode = 1;
}

// Run only when invoked as a script — the parser is imported by its test, and
// scanning the repo (or exiting) on import would break that.
if (process.argv[1]?.includes("check-spacing-scale")) main();
