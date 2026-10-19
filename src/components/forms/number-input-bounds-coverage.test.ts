import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS_DIR = resolve(process.cwd(), "src/components");

/** A number input names its bounds: a schema-driven spread or an explicit `min`. */
const BOUNDS_PATTERN = /\{\.\.\.[A-Za-z_]*(?:[Bb]ounds|BOUNDS)\b|\bmin=/;

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

/** The JSX opening tag around each `type="number"`, from its `<` to its `/>` or `>`. */
function numberInputTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/type="number"/g)) {
    const start = source.lastIndexOf("<", match.index);
    const end = source.indexOf("/>", match.index);
    tags.push(source.slice(start, end));
  }
  return tags;
}

describe("number input bounds coverage", () => {
  it("gives every number input a native min, preferably read from its Zod schema", () => {
    const unbounded = componentFiles(COMPONENTS_DIR).flatMap((file) =>
      numberInputTags(readFileSync(file, "utf8"))
        .filter((tag) => !BOUNDS_PATTERN.test(tag))
        .map((tag) => `${relative(COMPONENTS_DIR, file)}: ${tag.match(/id=\{?["`]?([^"`}\s]+)/)?.[1] ?? tag.slice(0, 60)}`),
    );

    expect(unbounded).toEqual([]);
  });
});
