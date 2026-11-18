import { readFileSync } from "node:fs";
import ts from "typescript";

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const REMOVALS_EXIT_CODE = 1;
const CHECK_ERROR_EXIT_CODE = 2;

/** @param {string} file */
function operationsIn(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Invalid TypeScript in ${file}`);
  const paths = source.statements.find((node) => ts.isInterfaceDeclaration(node)
    && node.name.text === "paths"
    && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  if (!paths) throw new Error(`Missing exported paths interface in ${file}`);

  const operations = new Set();
  for (const path of paths.members) {
    if (!ts.isPropertySignature(path) || !ts.isStringLiteral(path.name)
      || !path.type || !ts.isTypeLiteralNode(path.type)) {
      throw new Error(`Unexpected path declaration in ${file}`);
    }
    // Only inspect direct path members, never nested parameters or comments.
    for (const member of path.type.members) {
      if (!ts.isPropertySignature(member)
        || !(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) continue;
      const method = member.name.text;
      if (!HTTP_METHODS.has(method) || member.type?.kind === ts.SyntaxKind.NeverKeyword) continue;
      if (!member.type || !ts.isIndexedAccessTypeNode(member.type)
        || !ts.isTypeReferenceNode(member.type.objectType)
        || member.type.objectType.typeName.getText(source) !== "operations") {
        throw new Error(`Unexpected operation type for ${method.toUpperCase()} ${path.name.text} in ${file}`);
      }
      operations.add(`${method.toUpperCase()} ${path.name.text}`);
    }
  }
  return operations;
}

try {
  const [beforeFile, afterFile, ...extra] = process.argv.slice(2);
  if (!beforeFile || !afterFile || extra.length) {
    throw new Error("Usage: node scripts/certify-removed-operations.mjs <before.d.ts> <after.d.ts>");
  }
  const before = operationsIn(beforeFile);
  const after = operationsIn(afterFile);
  const removed = [...before].filter((operation) => !after.has(operation)).sort();
  if (removed.length) {
    console.log(removed.join("\n"));
    process.exitCode = REMOVALS_EXIT_CODE;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = CHECK_ERROR_EXIT_CODE;
}
