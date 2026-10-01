/**
 * Guard for the semantic binding catalog (#291, #637): a source file that
 * quotes both the blueprint key and the input key of a catalog binding is a
 * hand-kept mirror of the catalog. Resolve the binding through the catalog's
 * projections instead.
 *
 * Tests are exempt: they pin tuples on purpose. KNOWN_MIRRORS names each pair
 * a later #291 slice still owns, per file. It must match exactly, so a new
 * pair fails and a removed one must be dropped from the list.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SEMANTIC_BINDING_CATALOG } from "@/lib/isometric/semantic-binding-catalog";

const ROOT = join(__dirname, "..");
const SOURCE_DIR = join(ROOT, "src");
const CATALOG_MODULE = "src/lib/isometric/semantic-binding-catalog.ts";
const GENERATED_DIR = "src/lib/isometric/generated/";

const KNOWN_MIRRORS: Record<string, string[]> = {
  // Evidence targets for Isometric Sources; #638 moves them onto the catalog
  // roles.
  "src/lib/certification/removal-source-bindings.ts": [
    "carbon_rich_substance_sequestration/product_mass",
    "mass_distance_based_ci_emissions/mass_distance",
    "mass_based_ci_emissions/mass",
  ],
  "src/fn/certification/removal-snapshot-readers.ts": [
    "mass_distance_based_ci_emissions/mass_distance",
    "mass_based_ci_emissions/mass",
  ],
  // Template walk for the diesel warning; #639's compiled plan replaces it.
  "src/fn/certification/submission-warnings.ts": ["fuel_usage_by_volume/volume_of_fuel"],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [relative(ROOT, path)];
  });
}

const quoted = (key: string) => new RegExp(`["']${key}["']`);

const BINDING_PAIRS = Object.entries(SEMANTIC_BINDING_CATALOG).flatMap(([blueprint, inputs]) =>
  Object.keys(inputs).map((input) => [blueprint, input] as const),
);

function mirroredPairs(text: string): string[] {
  return BINDING_PAIRS.filter(
    ([blueprint, input]) => quoted(blueprint).test(text) && quoted(input).test(text),
  ).map(([blueprint, input]) => `${blueprint}/${input}`);
}

function literalMirrors(): Record<string, string[]> {
  const mirrors: Record<string, string[]> = {};
  for (const file of sourceFiles(SOURCE_DIR)) {
    if (file === CATALOG_MODULE || file.startsWith(GENERATED_DIR)) continue;
    const pairs = mirroredPairs(readFileSync(join(ROOT, file), "utf8"));
    if (pairs.length) mirrors[file] = pairs;
  }
  return mirrors;
}

describe("binding tuple literals", () => {
  it("are declared only in the catalog module, apart from the known mirrors", () => {
    expect(literalMirrors()).toEqual(KNOWN_MIRRORS);
  });

  it("catches a literal mirror and ignores prose", () => {
    // The pre-#637 field registry declared its tuples like this.
    expect(
      mirroredPairs('tuple("pyrolysis", "grid_electricity_use", "electricity_use")'),
    ).toEqual(["grid_electricity_use/electricity_use"]);
    expect(mirroredPairs("// `grid_electricity_use` / `electricity_use`")).toEqual([]);
  });

  it("fails on a new pair in a known-mirror file", () => {
    const file = "src/fn/certification/submission-warnings.ts";
    const text = `${readFileSync(join(ROOT, file), "utf8")}\nconst x = ["grid_electricity_use", "electricity_use"];`;
    expect(mirroredPairs(text)).not.toEqual(KNOWN_MIRRORS[file]);
  });
});
