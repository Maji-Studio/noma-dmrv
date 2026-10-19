import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pickers must reach the edit forms only through EntityEditDialog's next/dynamic import.
const SRC = resolve(process.cwd(), "src");
const EDIT_FORMS = resolve(SRC, "components/forms/entity-select/entity-edit-forms.tsx");
const PICKER_ENTRIES = [
  "components/forms/entity-select/form-entity-select.tsx",
  "components/forms/entity-select/entity-select.tsx",
  "components/forms/entity-select/formulation-quick-add-dialog.tsx",
  "components/forms/entity-select/supplier-quick-add-dialog.tsx",
  "components/forms/entity-select/feedstock-type-quick-add-dialog.tsx",
];
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
// Static value imports and re-exports; `import type` / `export type` and dynamic import() are skipped.
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/gm;

function resolveModule(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  if (existsSync(base) && /\.tsx?$/.test(base)) return base;
  const match = EXTENSIONS.map((ext) => base + ext).find((path) => existsSync(path));
  return match ?? null;
}

function reaches(entry: string, target: string): boolean {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (file === target) return true;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) {
      const next = resolveModule(specifier, file);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return false;
}

describe("picker bundle stays free of the edit forms", () => {
  it.each(PICKER_ENTRIES)("%s does not statically import entity-edit-forms", (entry) => {
    expect(reaches(resolve(SRC, entry), EDIT_FORMS)).toBe(false);
  });

  it("the walk finds the edit forms from EntityEditDialog itself", () => {
    expect(reaches(resolve(SRC, "components/forms/entity-select/entity-edit-dialog.tsx"), EDIT_FORMS)).toBe(true);
  });
});
