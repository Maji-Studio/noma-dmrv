/**
 * The marketing site's /why page quotes deriveMassDryKg verbatim, with line
 * numbers (site/src/components/site/why/MathExcerpt.astro). The site is a
 * separate package and cannot import the app, so this guard compares the
 * excerpt's tokens against the real source text and fails when they drift.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SOURCE_PATH = resolve(ROOT, "src/lib/calculations/mass-dry.ts");
const EXCERPT_PATH = resolve(
  ROOT,
  "site/src/components/site/why/MathExcerpt.astro",
);
const FUNCTION_START = "export function deriveMassDryKg(";
const FUNCTION_END = "}";

type Token = [text: string, kind?: string];

function readExcerpt() {
  const astro = readFileSync(EXCERPT_PATH, "utf8");
  const file = astro.match(/const FILE = "([^"]+)";/)?.[1];
  const firstLine = astro.match(/const FIRST_LINE = (\d+);/)?.[1];
  const hit = astro.match(/const HIT = (\d+);/)?.[1];
  const code = astro.match(/const CODE = (\[[\s\S]*?\n\]);/)?.[1];
  if (!file || !firstLine || !hit || !code) {
    throw new Error(
      "MathExcerpt.astro no longer declares FILE, FIRST_LINE, HIT and CODE; update this guard",
    );
  }
  // CODE is a JSON-shaped literal apart from its trailing commas.
  const tokens = JSON.parse(code.replace(/,(\s*\])/g, "$1")) as Token[][];
  return {
    file,
    firstLine: Number(firstLine),
    hit: Number(hit),
    lines: tokens.map((line) => line.map(([text]) => text).join("")),
  };
}

function readFunctionSource() {
  const lines = readFileSync(SOURCE_PATH, "utf8").split("\n");
  const start = lines.indexOf(FUNCTION_START);
  if (start === -1) throw new Error(`${FUNCTION_START} not found`);
  const end = lines.indexOf(FUNCTION_END, start);
  if (end === -1) throw new Error("deriveMassDryKg has no closing brace");
  return { firstLine: start + 1, lines: lines.slice(start, end + 1) };
}

describe("site /why MathExcerpt", () => {
  const excerpt = readExcerpt();
  const source = readFunctionSource();

  it("names the file the function lives in", () => {
    expect(resolve(ROOT, excerpt.file)).toBe(SOURCE_PATH);
  });

  it("quotes deriveMassDryKg verbatim", () => {
    expect(excerpt.lines).toEqual(source.lines);
  });

  it("numbers the lines as they are in the file", () => {
    expect(excerpt.firstLine).toBe(source.firstLine);
  });

  it("highlights the arithmetic line", () => {
    expect(excerpt.lines[excerpt.hit]).toMatch(/^\s*return roundKg\(/);
  });
});
