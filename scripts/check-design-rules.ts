/** Report-only helper for advisory design review; see .agents/skills/noma-design/SKILL.md. */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_DIR = "src";
const THEME_FILE = "src/app/globals.css";
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const TEST_FILE = /\.(?:test|spec)\.[jt]sx?$/;
const UI_DIRS = ["src/components/", "src/app/", "src/features/"];
const PRIMITIVES_DIR = "src/components/ui/";
// These own shared formatting, rather than consuming it. Neither is currently in UI_DIRS.
const FORMAT_HELPERS = new Set(["src/lib/format-utils.ts", "src/lib/date-utils.ts"]);
const LOCALE_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString"]);
const INTL_FORMATTERS = new Set(["DateTimeFormat", "RelativeTimeFormat", "DurationFormat"]);
const ALLOWED_RADIUS_VALUES = new Set(["none", "full", "4", "8"]);
const RADIUS_SIDES = "(?:[trblse]|tl|tr|bl|br|ss|se|es|ee)";
const RULES = ["radius", "shadow", "raw-button", "formatting"] as const;
type Rule = (typeof RULES)[number];
const DEFAULT_BASE = "origin/staging";
const CLI_ARGS_START = 2;
const EXIT_FAILURE = 1;
const DISPLAY_POSITION_OFFSET = 1;
const NEXT_ARGUMENT_OFFSET = 1;
const MESSAGES: Record<Rule, string> = {
  radius: "Use approved radius tokens from docs/design-system.md.",
  shadow: "Use the elevation tokens in docs/design-system.md (hairlines; shadow-none only).",
  "raw-button": "Use Button from src/components/ui (docs/design-system.md).",
  formatting: "Use shared formatters in src/lib/format-utils.ts / src/lib/date-utils.ts.",
};
const USAGE = `Usage: pnpm tsx scripts/check-design-rules.ts [options] [files...]

Report design findings for all source files, or just explicit files when supplied.
  --rule <name>       Select rules (repeatable or comma-separated).
                     Valid names: ${RULES.join(", ")}
  --changed [base]   Scan branch, tracked working-tree and untracked changes.
                     Default base: ${DEFAULT_BASE}
  --help             Print usage.
  --                 End options (also separates files from an optional base).

Findings are advisory and exit 0; usage and runtime errors exit non-zero.`;

export interface CliOptions {
  help: boolean;
  rules: readonly Rule[];
  changedBase?: string;
  files: string[];
}

export function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = { help: false, rules: [], files: [] };
  const selected = new Set<Rule>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") {
      options.files.push(...args.slice(index + NEXT_ARGUMENT_OFFSET));
      break;
    }
    if (argument === "--help") {
      options.help = true;
    } else if (argument === "--rule") {
      const value = args[++index];
      if (!value || value.startsWith("-")) {
        throw new Error(`--rule requires a name. Valid names: ${RULES.join(", ")}`);
      }
      for (const name of value.split(",").map((name) => name.trim())) {
        if (!RULES.includes(name as Rule)) {
          throw new Error(`Unknown design rule: ${name}. Valid names: ${RULES.join(", ")}`);
        }
        selected.add(name as Rule);
      }
    } else if (argument === "--changed") {
      const base = args[index + NEXT_ARGUMENT_OFFSET];
      options.changedBase = base && !base.startsWith("-") ? args[++index] : DEFAULT_BASE;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}. Use --help for usage.`);
    } else {
      options.files.push(argument);
    }
  }
  options.rules = selected.size ? [...selected] : RULES;
  return options;
}

export function filterChangedFiles(
  paths: readonly string[],
  exists: (file: string) => boolean = (file) => existsSync(join(ROOT, file)),
): string[] {
  return [...new Set(paths.map((file) => posix.normalize(file)))].filter((file) =>
    file.startsWith(`${SOURCE_DIR}/`) && EXTENSIONS.has(extname(file)) &&
    !TEST_FILE.test(file) && exists(file)).sort();
}

function changedFiles(base: string): string[] {
  const gitFiles = (args: string[]): string[] =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  const paths = [
    ...gitFiles(["diff", "--name-only", "--diff-filter=d", "-z", `${base}...HEAD`, "--"]),
    ...gitFiles(["diff", "--name-only", "--diff-filter=d", "-z", "HEAD", "--"]),
    ...gitFiles(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  return filterChangedFiles(paths);
}

export interface Violation {
  rule: Rule;
  file: string;
  line: number;
  column: number;
  value: string;
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    return !TEST_FILE.test(entry.name) && EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

/** Allow only approved theme radii, plus the built-in none utility. */
export function loadRadiusValues(css: string): Set<string> {
  const values = new Set(["none"]);
  for (const match of css.matchAll(/--radius-([\w-]+)\s*:\s*([^;]+);/g)) {
    if (ALLOWED_RADIUS_VALUES.has(match[1]) && match[2].trim() !== "initial") values.add(match[1]);
  }
  if (values.size === 1) throw new Error(`No approved radius tokens found in ${THEME_FILE}. Update the check.`);
  return values;
}

/** Colons inside arbitrary variants/values are not variant separators. */
export function stripVariants(token: string): string {
  let depth = 0;
  let start = 0;
  let escaped = false;
  for (let index = 0; index < token.length; index++) {
    const character = token[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character === "[" || character === "(") depth++;
    if (character === "]" || character === ")") depth--;
    if (character === ":" && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!/, "").replace(/!$/, "");
}

export function matchClass(token: string, radiusValues: ReadonlySet<string>): Rule | null {
  const bare = stripVariants(token);
  if (bare === "rounded" || bare.startsWith("rounded-")) {
    const value = bare.replace(new RegExp(`^rounded-(?:${RADIUS_SIDES}-)?`), "");
    return radiusValues.has(value) ? null : "radius";
  }
  // New code uses hairlines for elevation and only shadow-none is allowed.
  if (bare === "shadow" || (bare.startsWith("shadow-") && bare !== "shadow-none")) return "shadow";
  return null;
}

function isClassContext(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) return parent.name.getText() === "className";
    if (ts.isCallExpression(parent) && /^(?:cn|cva|clsx)$/.test(parent.expression.getText())) return true;
    if (ts.isVariableDeclaration(parent) && /class|style|variant/i.test(parent.name.getText())) return true;
  }
  return false;
}

/** Parse literals, including every static segment of interpolated templates, maps and arrays. */
export function findDesignViolations(source: string, file: string, radiusValues: ReadonlySet<string>): Violation[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];
  const inUI = UI_DIRS.some((directory) => file.startsWith(directory)) && !FORMAT_HELPERS.has(file);
  const report = (node: ts.Node, rule: Rule, value: string, position = node.getStart(sourceFile)): void => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
    violations.push({ rule, file, line: line + DISPLAY_POSITION_OFFSET, column: character + DISPLAY_POSITION_OFFSET, value });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const context = isClassContext(node);
      const attribute = ts.isJsxAttribute(node.parent) ? node.parent : undefined;
      if (!attribute || context) {
        for (const match of node.text.matchAll(/\S+/g)) {
          const token = match[0];
          const bare = stripVariants(token);
          // Ordinary copy uses the words "rounded" and "shadow" too.
          if ((bare === "rounded" || bare === "shadow") && !context && node.text.trim() !== token) continue;
          const rule = matchClass(token, radiusValues);
          if (rule) report(node, rule, token, node.getStart(sourceFile) + 1 + match.index);
        }
      }
    }
    if (/\.[jt]sx$/.test(file) && !file.startsWith(PRIMITIVES_DIR) &&
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === "button") {
      report(node, "raw-button", "<button");
    }
    if (inUI && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text
        : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
      if (name && LOCALE_METHODS.has(name)) {
        report(node, "formatting", name);
      } else if (name && INTL_FORMATTERS.has(name) && node.expression.getText() === "Intl") {
        report(node, "formatting", `Intl.${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function main(): void {
  const options = parseArgs(process.argv.slice(CLI_ARGS_START));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const files = options.files.length
    ? filterChangedFiles(options.files.map((file) => relative(ROOT, resolve(ROOT, file))))
    : options.changedBase !== undefined
      ? changedFiles(options.changedBase)
      : filterChangedFiles(walkFiles(join(ROOT, SOURCE_DIR)).map((file) => relative(ROOT, file)));
  const radiusValues = loadRadiusValues(readFileSync(join(ROOT, THEME_FILE), "utf8"));
  const violations = files.flatMap((file) =>
    findDesignViolations(readFileSync(join(ROOT, file), "utf8"), file, radiusValues))
    .filter((hit) => options.rules.includes(hit.rule))
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column);
  for (const hit of violations) {
    console.log(`${hit.file}:${hit.line}:${hit.column}  ${hit.rule}  ${hit.value}  ${MESSAGES[hit.rule]}`);
  }
  const counts = options.rules.map((rule) => `${rule}: ${violations.filter((hit) => hit.rule === rule).length}`);
  const summary = `${counts.join(", ")}; ${files.length} file(s) scanned.`;
  console.log(violations.length ? summary : `No findings. ${summary}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_FAILURE;
  }
}
