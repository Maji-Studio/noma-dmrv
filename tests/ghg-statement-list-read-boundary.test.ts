import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    process.cwd(),
    "src/fn/certification/ghg-statements.ts",
  ),
  "utf8",
);

function functionSource(name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  const nextExport = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("GHG Statement list read boundary", () => {
  it("does not reconcile with the registry during a page-load query", () => {
    const loader = functionSource("loadGhgStatementsForFacility");

    expect(loader).not.toContain("reconcileGhgStatementsForFacility");
    expect(loader).not.toContain("getIsometricClientForOrg");
  });
});
