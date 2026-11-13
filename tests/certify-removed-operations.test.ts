import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const typesFile = "src/lib/isometric/generated/certify.d.ts";
const script = join(root, "scripts/certify-removed-operations.mjs");
const baseline = execFileSync("git", ["show", `HEAD:${typesFile}`], { cwd: root, encoding: "utf8" });

function compare(before: string, after = before) {
  const directory = mkdtempSync(join(tmpdir(), "certify-operations-"));
  try {
    const beforeFile = join(directory, "before.d.ts");
    const afterFile = join(directory, "after.d.ts");
    writeFileSync(beforeFile, before);
    writeFileSync(afterFile, after);
    return spawnSync(process.execPath, [script, beforeFile, afterFile], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("committed Certify types compared with themselves have no removals", () => {
  const result = compare(baseline);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test.each(["missing", "never"])("reports every operation from a deleted real path and a %s method", (mode) => {
  const source = ts.createSourceFile(typesFile, baseline, ts.ScriptTarget.Latest, true);
  const paths = source.statements.find((node): node is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(node) && node.name.text === "paths");
  assert.ok(paths);
  const path = (name: string) => paths.members.find((member): member is ts.PropertySignature =>
    ts.isPropertySignature(member) && ts.isStringLiteral(member.name) && member.name.text === name);
  const removedPath = path("/ghg_entries");
  const remainingPath = path("/datapoints/{id}");
  assert.ok(removedPath && remainingPath?.type && ts.isTypeLiteralNode(remainingPath.type));
  const patch = remainingPath.type.members.find((member) => member.name?.getText(source) === "patch");
  assert.ok(patch);
  const edits = [
    { start: removedPath.getStart(source), end: removedPath.end, text: "" },
    { start: patch.getStart(source), end: patch.end, text: mode === "never" ? "patch?: never;" : "" },
  ].sort((left, right) => right.start - left.start);
  const changed = edits.reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), baseline);
  const result = compare(baseline, changed);
  assert.equal(result.status, 1, result.stderr);
  // Derive the deleted path's operations from the baseline so new upstream methods do not break the test.
  assert.ok(removedPath.type && ts.isTypeLiteralNode(removedPath.type));
  const removedPathOperations = removedPath.type.members
    .filter((member) => ts.isPropertySignature(member) && member.type?.kind !== ts.SyntaxKind.NeverKeyword
      && ["get", "put", "post", "delete", "options", "head", "patch", "trace"].includes(member.name.getText(source)))
    .map((member) => `${member.name!.getText(source).toUpperCase()} /ghg_entries`);
  assert.ok(removedPathOperations.includes("POST /ghg_entries"));
  assert.deepEqual(result.stdout.trim().split("\n"), [...removedPathOperations, "PATCH /datapoints/{id}"].sort());
});

const fixture = `export interface paths {
  "/example": {
    parameters: { query: { get: operations["nested"]; post?: never }; };
    /** get: operations["comment"]; */
    get: operations["read"];
    post?: never;
  };
}
export interface operations { read: {}; nested: {}; }
`;

test("additions, descriptions and operation ID changes are compatible and nested parameters are ignored", () => {
  const changed = fixture.replace('get: operations["nested"]', "get?: never")
    .replace('get: operations["read"]', '/** New description */ get: operations["renamed"]')
    .replace("post?: never;", 'post: operations["create"];');
  const result = compare(fixture, changed);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test.each(["", "export interface paths {", 'export interface paths { "/example": string; }'])(
  "fails closed for malformed or unsupported generated types: %s", (changed) => {
    const result = compare(fixture, changed);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Missing exported paths|Invalid TypeScript|Unexpected path/);
  },
);
