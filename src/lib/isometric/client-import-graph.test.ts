import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  baseUrl: ROOT,
  paths: { "@/*": ["*"] },
};

/** Walk runtime imports/re-exports, excluding erased type-only dependencies. */
function nodeImports(entry: string): string[] {
  const visited = new Set<string>();
  const findings: string[] = [];
  function walk(file: string, chain: string[]) {
    if (visited.has(file)) return;
    visited.add(file);
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: COMPILER_OPTIONS,
    });
    const source = ts.createSourceFile(file, outputText, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === "require"))
          ? node.arguments[0]
          : undefined;
      if (specifier && ts.isStringLiteral(specifier)) {
        const name = specifier.text;
        if (name.startsWith("node:")) findings.push([...chain, name].join(" -> "));
        else if (name.startsWith(".") || name.startsWith("@/")) {
          const dependency = ts.resolveModuleName(name, file, COMPILER_OPTIONS, ts.sys).resolvedModule;
          if (!dependency) throw new Error(`Cannot resolve ${name} from ${dirname(file)}`);
          walk(dependency.resolvedFileName, [...chain, name]);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  walk(resolve(ROOT, entry), [entry]);
  return findings;
}

describe("client-safe certification import graphs", () => {
  it.each([
    "lib/isometric/template-binding-coverage.ts",
    "lib/isometric/datapoint-mapping.ts",
    "lib/certification/readiness.ts",
  ])("keeps Node imports out of %s", (entry) => {
    expect(nodeImports(entry)).toEqual([]);
  });

  it("detects the server transformer's supplier-reference crypto dependency", () => {
    expect(nodeImports("lib/isometric/transformers/sequestration-binding.ts"))
      .toEqual(expect.arrayContaining([expect.stringContaining("node:crypto")]));
  });
});
