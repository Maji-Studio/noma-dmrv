#!/usr/bin/env node

/**
 * Check the active documentation surface without imposing current-tree
 * correctness on historical snapshots.
 *
 * Scope:
 * - repository-root Markdown files;
 * - Markdown files under docs/;
 * - docs/archive/** is deliberately excluded from enforcement.
 *
 * In addition to Markdown links, inline-code references are checked when they
 * clearly name a repository path (for example `src/lib/errors.ts:SafeError`).
 * Globs, templates, aliases that do not identify one file, absolute machine
 * paths, application routes, URLs, and fenced examples are deliberately
 * ignored.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archiveRoot = path.join(repoRoot, "docs", "archive");
const extensionCandidates = [
  "",
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
];
const rootFileNames = new Set([
  "AGENTS.md",
  "CONTEXT.md",
  "README.md",
  "TEMPLATE_USAGE.md",
  "drizzle.config.ts",
  "eslint.config.mjs",
  "next.config.ts",
  "package.json",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "tsconfig.json",
]);
const repositoryPrefixes = [
  ".agents/",
  ".claude/",
  ".github/",
  ".greptile/",
  "docs/",
  "drizzle/",
  "public/",
  "scripts/",
  "src/",
  "tests/",
];

const failures = [];
const seenFailures = new Set();
let markdownLinkCount = 0;
let repositoryReferenceCount = 0;

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function walkMarkdown(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (isInside(archiveRoot, absolute)) continue;
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(absolute);
    }
  }
  return files;
}

const markdownFiles = [
  ...fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(repoRoot, entry.name)),
  ...walkMarkdown(path.join(repoRoot, "docs")),
].sort();

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function addFailure(sourceFile, line, message) {
  const relative = path.relative(repoRoot, sourceFile);
  const rendered = `${relative}:${line}: ${message}`;
  if (seenFailures.has(rendered)) return;
  seenFailures.add(rendered);
  failures.push(rendered);
}

function stripFencedCodeAndComments(markdown) {
  let inFence = false;
  let fenceMarker = "";
  let inComment = false;

  return markdown
    .split("\n")
    .map((line) => {
      if (inComment) {
        if (line.includes("-->")) inComment = false;
        return "";
      }
      if (line.includes("<!--")) {
        if (!line.includes("-->", line.indexOf("<!--") + 4)) inComment = true;
        return line.slice(0, line.indexOf("<!--"));
      }

      const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1][0];
        if (!inFence) {
          inFence = true;
          fenceMarker = marker;
        } else if (marker === fenceMarker) {
          inFence = false;
          fenceMarker = "";
        }
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

function extractMarkdownDestinations(markdown) {
  const destinations = [];

  // Reference definitions: [label]: destination "optional title"
  const definitionPattern = /^\s{0,3}\[[^\]]+\]:\s*(<[^>\n]+>|[^\s]+)(?:\s+.*)?$/gm;
  for (const match of markdown.matchAll(definitionPattern)) {
    destinations.push({
      destination: unwrapAngleDestination(match[1]),
      offset: match.index ?? 0,
    });
  }

  // Inline links and images. Balanced parentheses preserve destinations such
  // as `guide_(draft).md`; angle brackets preserve spaces.
  for (let index = 0; index < markdown.length - 2; index += 1) {
    if (markdown[index] !== "]" || markdown[index + 1] !== "(") continue;
    const start = index + 2;
    let cursor = start;

    while (/\s/.test(markdown[cursor] ?? "")) cursor += 1;
    if (markdown[cursor] === "<") {
      const closeAngle = markdown.indexOf(">", cursor + 1);
      if (closeAngle === -1) continue;
      let closeParen = closeAngle + 1;
      while (closeParen < markdown.length && markdown[closeParen] !== ")") {
        closeParen += 1;
      }
      if (markdown[closeParen] !== ")") continue;
      destinations.push({
        destination: markdown.slice(cursor + 1, closeAngle),
        offset: start,
      });
      index = closeParen;
      continue;
    }

    let depth = 1;
    let escaped = false;
    for (; cursor < markdown.length; cursor += 1) {
      const character = markdown[cursor];
      if (character === "\n") break;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;

    const contents = markdown.slice(start, cursor).trim();
    const withoutTitle = contents.replace(/\s+(?:"[^"]*"|'[^']*')\s*$/, "");
    if (withoutTitle) {
      destinations.push({ destination: withoutTitle, offset: start });
    }
    index = cursor;
  }

  return destinations;
}

function unwrapAngleDestination(destination) {
  const trimmed = destination.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function unescapeMarkdownDestination(destination) {
  return destination.replace(/\\([\\()[\]<> ])/g, "$1");
}

function isIgnoredDestination(destination) {
  const trimmed = destination.trim();
  return (
    trimmed === "" ||
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed) ||
    /[*{}<>$]/.test(trimmed)
  );
}

function splitPathSuffix(rawDestination) {
  const unescaped = unescapeMarkdownDestination(rawDestination);
  const hashIndex = unescaped.indexOf("#");
  const beforeHash = hashIndex === -1 ? unescaped : unescaped.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : unescaped.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf("?");
  const pathname = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  return { pathname, fragment };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripConcreteSuffix(reference) {
  return reference
    .replace(/#L\d+(?:-L?\d+)?$/i, "")
    .replace(
      /(\.(?:md|tsx?|jsx?|mjs|cjs|json|ya?ml|sql|css|png|jpe?g|gif|svg|pdf|txt)):(?:\d+(?::\d+)?(?:-\d+)?|[A-Za-z_$][\w$.-]*)$/,
      "$1",
    )
    .replace(/[.,;]$/, "");
}

function resolveExistingPath(basePath) {
  for (const extension of extensionCandidates) {
    const candidate = `${basePath}${extension}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const extension of extensionCandidates.slice(1)) {
    const candidate = path.join(basePath, `index${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function headingSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const headingCache = new Map();

function markdownAnchors(markdownFile) {
  const cached = headingCache.get(markdownFile);
  if (cached) return cached;

  const markdown = fs.readFileSync(markdownFile, "utf8");
  const anchors = new Set();
  const duplicateCounts = new Map();
  for (const line of stripFencedCodeAndComments(markdown).split("\n")) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const base = headingSlug(heading[1]);
    const duplicate = duplicateCounts.get(base) ?? 0;
    anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`);
    duplicateCounts.set(base, duplicate + 1);
  }
  for (const match of markdown.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) {
    anchors.add(match[1]);
  }
  headingCache.set(markdownFile, anchors);
  return anchors;
}

function validateFragment(sourceFile, line, targetFile, rawFragment) {
  if (!rawFragment || !targetFile || !fs.statSync(targetFile).isFile()) return;
  const fragment = safeDecode(rawFragment);
  const lineFragment = fragment.match(/^L(\d+)(?:-L?(\d+))?$/i);
  if (lineFragment) {
    const lineCount = fs.readFileSync(targetFile, "utf8").split("\n").length;
    if (Number(lineFragment[1]) > lineCount) {
      addFailure(sourceFile, line, `line fragment #${fragment} exceeds ${path.relative(repoRoot, targetFile)}`);
    }
    return;
  }
  if (!targetFile.endsWith(".md")) return;
  if (!markdownAnchors(targetFile).has(fragment)) {
    addFailure(
      sourceFile,
      line,
      `missing fragment #${fragment} in ${path.relative(repoRoot, targetFile)}`,
    );
  }
}

function validateMarkdownDestination(sourceFile, markdown, item) {
  const destination = item.destination.trim();
  if (isIgnoredDestination(destination)) return;
  if (destination.startsWith("/") && !destination.startsWith("/docs/")) return;

  markdownLinkCount += 1;
  const { pathname: rawPathname, fragment } = splitPathSuffix(destination);
  const pathname = safeDecode(rawPathname);
  const targetBase =
    pathname === ""
      ? sourceFile
      : pathname.startsWith("/docs/")
        ? path.join(repoRoot, pathname.slice(1))
        : path.resolve(path.dirname(sourceFile), stripConcreteSuffix(pathname));

  const target = resolveExistingPath(targetBase);
  const line = lineNumberAt(markdown, item.offset);
  if (!target || !isInside(repoRoot, target)) {
    addFailure(sourceFile, line, `missing local link target: ${destination}`);
    return;
  }
  validateFragment(sourceFile, line, target, fragment);
}

function isDeliberatePattern(reference) {
  return (
    /[*{}<>$]/.test(reference) ||
    /(?:^|\/)(?:example|path|to)\/?$/i.test(reference) ||
    reference.includes("…") ||
    reference.includes("...")
  );
}

function repositoryReferenceBase(reference, sourceFile) {
  let cleaned = stripConcreteSuffix(reference.trim());
  if (cleaned.startsWith("@/")) cleaned = `src/${cleaned.slice(2)}`;
  if (cleaned.startsWith("./") || cleaned.startsWith("../")) {
    return path.resolve(path.dirname(sourceFile), cleaned);
  }
  if (
    repositoryPrefixes.some((prefix) => cleaned.startsWith(prefix)) ||
    rootFileNames.has(cleaned)
  ) {
    return path.resolve(repoRoot, cleaned);
  }
  return null;
}

function extractRepositoryReferences(markdown) {
  const references = [];
  const inlineCodePattern = /(`+)([^`\n]+?)\1/g;
  for (const match of markdown.matchAll(inlineCodePattern)) {
    const contents = match[2].trim();
    if (isDeliberatePattern(contents)) continue;

    // Most concrete references occupy the whole code span. Splitting on comma
    // supports compact lists without interpreting commands or prose as paths.
    for (const part of contents.split(/\s*,\s*/)) {
      const candidate = part.trim();
      if (
        candidate.startsWith("@/") ||
        candidate.startsWith("./") ||
        candidate.startsWith("../") ||
        repositoryPrefixes.some((prefix) => candidate.startsWith(prefix)) ||
        rootFileNames.has(stripConcreteSuffix(candidate))
      ) {
        references.push({
          reference: candidate,
          offset: (match.index ?? 0) + match[0].indexOf(candidate),
        });
      }
    }
  }
  return references;
}

function validateRepositoryReference(sourceFile, markdown, item) {
  if (isDeliberatePattern(item.reference) || path.isAbsolute(item.reference)) return;
  const targetBase = repositoryReferenceBase(item.reference, sourceFile);
  if (!targetBase) return;

  repositoryReferenceCount += 1;
  const target = resolveExistingPath(targetBase);
  if (!target || !isInside(repoRoot, target)) {
    addFailure(
      sourceFile,
      lineNumberAt(markdown, item.offset),
      `missing repository reference: ${item.reference}`,
    );
  }
}

for (const sourceFile of markdownFiles) {
  const original = fs.readFileSync(sourceFile, "utf8");
  const markdown = stripFencedCodeAndComments(original);

  for (const item of extractMarkdownDestinations(markdown)) {
    validateMarkdownDestination(sourceFile, markdown, item);
  }
  for (const item of extractRepositoryReferences(markdown)) {
    validateRepositoryReference(sourceFile, markdown, item);
  }
}

if (failures.length > 0) {
  console.error(`docs:check found ${failures.length} broken reference(s):`);
  for (const failure of failures.sort()) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `docs:check passed (${markdownFiles.length} active Markdown files, ` +
      `${markdownLinkCount} local links, ${repositoryReferenceCount} repository references).`,
  );
}
