/**
 * Heuristic guard against unscoped domain-table access in data-access modules.
 *
 * This is intentionally not a TypeScript parser. It finds db/tx select/insert/
 * update/delete chains through their terminating semicolon, identifies schema
 * table references, and requires organizationId to appear in domain chains.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const SCANNED_DIRS = [join(ROOT, "src/data-access"), join(ROOT, "src/fn")];
const SCHEMA_DIR = join(ROOT, "src/db/schema");
const WAIVER = /\/\/\s*org-scope-ok:\s*\S/;

const EXEMPT_TABLES = new Set([
  "users",
  "sessions",
  "accounts",
  "verifications",
  "organizations",
  "members",
  "invitations",
  "geoRouteCache",
]);

interface Violation {
  file: string;
  line: number;
  tables: string[];
}

function walkTsFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkTsFiles(path);
    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

function loadDomainTables(): Set<string> {
  const tables = new Set<string>();
  const declaration = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*pgTable\s*\(/g;

  for (const file of walkTsFiles(SCHEMA_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(declaration)) {
      const table = match[1];
      if (table && !EXEMPT_TABLES.has(table)) tables.add(table);
    }
  }

  return tables;
}

function findChainEnd(source: string, start: number): number {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === ";") {
      return index + 1;
    }
  }

  return source.length;
}

function referencedTables(chain: string): Set<string> {
  const tables = new Set<string>();
  const tableCall =
    /\.(?:from|insert|update|delete|innerJoin|leftJoin|rightJoin|fullJoin)\s*\(\s*(?:schema\.)?([A-Za-z_$][\w$]*)/g;

  for (const match of chain.matchAll(tableCall)) {
    if (match[1]) tables.add(match[1]);
  }
  return tables;
}

function inspectFile(file: string, domainTables: Set<string>): Violation[] {
  const source = readFileSync(file, "utf8");
  const violations: Violation[] = [];
  const chainStart =
    /\b(?:db|tx)\s*\.\s*(select|insert|update|delete)\s*\(/g;

  for (const match of source.matchAll(chainStart)) {
    if (match.index === undefined) continue;
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const previousLineStart =
      source.lastIndexOf("\n", Math.max(0, lineStart - 2)) + 1;
    const firstLineEnd = source.indexOf("\n", match.index);
    const waiverLines = source.slice(
      previousLineStart,
      firstLineEnd === -1 ? source.length : firstLineEnd,
    );
    if (WAIVER.test(waiverLines)) continue;

    const chain = source.slice(match.index, findChainEnd(source, match.index));
    const tables = [...referencedTables(chain)].filter((table) =>
      domainTables.has(table),
    );
    const operation = match[1];
    const whereStart = chain.search(/\.where\s*\(/);
    const scopedPortion =
      operation === "update" || operation === "delete"
        ? whereStart === -1
          ? ""
          : chain.slice(whereStart)
        : chain;
    if (tables.length === 0 || scopedPortion.includes("organizationId"))
      continue;

    violations.push({
      file: relative(ROOT, file),
      line: source.slice(0, match.index).split("\n").length,
      tables: [...new Set(tables)].sort(),
    });
  }

  return violations;
}

const domainTables = loadDomainTables();
const violations = SCANNED_DIRS.flatMap((directory) =>
  walkTsFiles(directory).flatMap((file) => inspectFile(file, domainTables)),
);

if (violations.length > 0) {
  console.error("Org-scoping check found unscoped domain-table chains:");
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line} (${violation.tables.join(", ")})`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("Org-scoping check passed.");
}
