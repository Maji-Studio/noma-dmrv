/**
 * Guard against en and em dashes in user-facing copy.
 *
 * docs/ux-writing.md bans both characters in interface text: "Do not use an
 * en dash or em dash. Use a full stop, comma, colon, or parentheses instead."
 * Nothing enforced that rule, so dashes kept creeping back in through new
 * copy and generated content.
 *
 * Unlike the sibling heuristics, this check parses each file with the
 * TypeScript compiler API and inspects only string literals, template
 * literals, and JSX text — the places rendered copy can live. Comments are
 * ignored entirely: the repo carries hundreds of legitimate dashes in prose
 * comments, and a raw grep would drown the signal.
 *
 * Colocated tests are skipped for the same reason as in
 * check-spacing-scale.ts: a test may assert on the exact violation this gate
 * exists to catch. Generated Isometric types are upstream text, not ours.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SCANNED_DIR = join(ROOT, "src");
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_FILE = /\.test\.tsx?$/;
const EXCLUDED_DIRS = [join("src", "lib", "isometric", "generated")];

const BANNED = /[–—]/;
/** JSX renders HTML entities, so an entity-encoded dash is still a dash. */
const BANNED_JSX_ENTITY = /&(?:mdash|ndash|#8211|#8212|#x201[34]);/i;
const BANNED_NAMES: Record<string, string> = {
  "–": "en dash",
  "—": "em dash",
};

interface Violation {
  file: string;
  line: number;
  character: string;
  excerpt: string;
}

function walkSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const relativePath = relative(ROOT, path);
      if (
        EXCLUDED_DIRS.some(
          (dir) => relativePath.startsWith(dir + sep) || relativePath === dir,
        )
      ) {
        return [];
      }
      return walkSourceFiles(path);
    }
    if (TEST_FILE.test(entry.name)) return [];
    return SCANNED_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

function isCopyBearingNode(node: ts.Node): node is ts.LiteralLikeNode {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    ts.isJsxText(node)
  );
}

/**
 * Every dash-bearing copy node in one source text. Exported for
 * `tests/check-ux-copy.test.ts` — the scanner is the whole gate, and a gate
 * nobody tests is a gate that quietly stops catching things.
 */
export function findDashViolations(
  source: string,
  fileName: string,
): Omit<Violation, "file">[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const violations: Omit<Violation, "file">[] = [];
  const visit = (node: ts.Node): void => {
    if (isCopyBearingNode(node)) {
      // A string that IS a lone dash is an empty-value placeholder glyph
      // (PDF and table cells render "—" for missing data), not prose — the
      // ban targets dashes used as sentence punctuation.
      const trimmed = node.text.trim();
      const literalMatch =
        trimmed.length > 1 ? BANNED.exec(node.text) : null;
      const entityMatch = ts.isJsxText(node)
        ? BANNED_JSX_ENTITY.exec(node.text)
        : null;
      const match = literalMatch ?? entityMatch;
      if (match) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        const flat = node.text.replace(/\s+/g, " ").trim();
        const at = flat.search(literalMatch ? BANNED : BANNED_JSX_ENTITY);
        violations.push({
          line: line + 1,
          character: literalMatch
            ? (BANNED_NAMES[match[0]] ?? "dash")
            : "dash entity",
          excerpt:
            flat.length > 60
              ? `${flat.slice(Math.max(0, at - 25), at + 30)}…`
              : flat,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function main(): void {
  const violations: Violation[] = [];
  for (const file of walkSourceFiles(SCANNED_DIR)) {
    const source = readFileSync(file, "utf8");
    if (!BANNED.test(source)) continue;
    for (const violation of findDashViolations(source, file)) {
      violations.push({ ...violation, file: relative(ROOT, file) });
    }
  }

  if (violations.length === 0) {
    console.log(
      "check:ux-copy — no en or em dashes in string literals or JSX text.",
    );
    return;
  }

  console.error(
    `check:ux-copy — ${violations.length} dash(es) in copy-bearing strings:\n`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line}  ${violation.character}\n` +
        `      "${violation.excerpt}"`,
    );
  }
  console.error(
    "\ndocs/ux-writing.md bans en and em dashes in user-facing copy. Use a\n" +
      "full stop, comma, colon, or parentheses instead. If the string is not\n" +
      "copy, restructure so the dash lives outside a string literal.",
  );
  process.exitCode = 1;
}

// Run only when invoked as a script — the scanner is imported by its test,
// and scanning the repo (or exiting) on import would break that.
if (process.argv[1]?.includes("check-ux-copy")) main();
