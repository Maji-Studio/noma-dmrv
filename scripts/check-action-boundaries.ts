/**
 * Prevent hand-rolled action boundaries and hook unwraps growing back.
 * Exceptions are named, explained, and checked for staleness. The boundary
 * contract and the three kinds of remaining catch live in docs/architecture.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { unwrapExpression } from "./server-action-types";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_FILE = /\.(?:test|spec)\.tsx?$/;
const BOUNDARY_FILE = "src/fn/with-action.ts";
const FAILURE_FILE = "src/fn/action-errors.ts";
const AUTH_MODULES = new Set(["@/lib/auth/server", "@/lib/auth"]);
const RELATIVE_AUTH_MODULE = /^\.\.?\/(?:.*\/)?lib\/auth(?:\/server)?$/;
const FAILURE_MODULES = new Set(["@/fn/action-errors"]);
const RELATIVE_FAILURE_MODULE = /^\.\.?\/(?:.*\/)?action-errors$/;
const FAILURE_NAME = "toActionFailure";
const ORG_CONTEXT_NAMES = new Set(["requireOrgContext", "getOrgContext"]);
const SITE_KINDS = ["org-context", "catch-failure", "action-failure", "hook-unwrap"] as const;
const DOC_POINTER = "See docs/architecture.md (withAction).";

export type ActionBoundaryKind = typeof SITE_KINDS[number];

export interface ActionBoundaryException {
  file: string;
  function: string;
  sites: Partial<Record<ActionBoundaryKind, number>>;
  reason: string;
}

export interface ActionBoundaryViolation {
  file: string;
  line: number;
  function: string;
  kind: ActionBoundaryKind;
  message: string;
}

export const ACTION_BOUNDARY_ALLOWLIST: readonly ActionBoundaryException[] = [
  {
    file: "src/fn/invitation-bootstrap.ts",
    function: "toWarnableResult",
    sites: { "catch-failure": 2 },
    reason: "Invitation bootstrap runs before an account or active organization exists.",
  },
  {
    file: "src/fn/organizations.ts",
    function: "toWarnableResult",
    sites: { "catch-failure": 4 },
    reason: "Shared boundary preserves Better Auth APIError messages and supports actions without an active org.",
  },
  {
    file: "src/fn/organizations.ts",
    function: "inviteMemberAction",
    sites: { "org-context": 1 },
    reason: "Invitation creation surfaces Better Auth's own non-SafeError APIError message.",
  },
  {
    file: "src/fn/organization-api-access.ts",
    function: "toResult",
    sites: { "action-failure": 1 },
    reason: "Platform Admin API access management runs without an active organization.",
  },
  {
    file: "src/fn/organizations.ts",
    function: "revokeInvitationAction",
    sites: { "org-context": 1 },
    reason: "Invitation cancellation surfaces Better Auth's own non-SafeError APIError message.",
  },
  {
    file: "src/fn/organizations.ts",
    function: "changeMemberRoleAction",
    sites: { "org-context": 1 },
    reason: "Member role changes surface Better Auth's own non-SafeError APIError message.",
  },
  {
    file: "src/fn/organizations.ts",
    function: "removeMemberAction",
    sites: { "org-context": 1 },
    reason: "Member removal surfaces Better Auth's own non-SafeError APIError message.",
  },
  {
    file: "src/hooks/types.ts",
    function: "unwrap",
    sites: { "hook-unwrap": 1 },
    reason: "Canonical unwrap implementation owns the shared ActionResult error throw.",
  },
  {
    file: "src/hooks/use-bin-movements.ts",
    function: "throwRecordLossError",
    sites: { "hook-unwrap": 1 },
    reason: "Loss failures preserve typed field and conflict errors before the generic fallback.",
  },
  {
    file: "src/hooks/use-bin-movements.ts",
    function: "useRecordStockTake",
    sites: { "hook-unwrap": 1 },
    reason: "Stock-take failures preserve a typed counted-field error before the generic fallback.",
  },
  {
    file: "src/hooks/use-credit-batches.ts",
    function: "useCreateCreditBatch",
    sites: { "hook-unwrap": 1 },
    reason: "Returns the committed credit batch together with its post-commit warning.",
  },
  {
    file: "src/hooks/use-production-run-readings.ts",
    function: "useDeleteAllProductionRunReadings",
    sites: { "hook-unwrap": 1 },
    reason: "Projects result.data.deletedCount rather than returning result.data.",
  },
  {
    file: "src/hooks/use-storage-location-sync.ts",
    function: "useSyncApplicationStorageLocation",
    sites: { "hook-unwrap": 1 },
    reason: "Returns applicationId with result.data so onSuccess can update the application's cache.",
  },
];

/** Anonymous query/mutation callbacks belong to their enclosing named hook. */
function enclosingFunction(node: ts.Node): string {
  for (let current = node.parent; current; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isMethodDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent)
    ) {
      return current.parent.name.getText();
    }
  }
  return "<module>";
}

function returnedFromCatch(node: ts.ReturnStatement): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isCatchClause(current)) return true;
    // A callback declared inside a catch returns to its own caller.
    if (ts.isFunctionLike(current)) return false;
  }
  return false;
}

function isFailureLiteral(expression: ts.Expression): boolean {
  const value = unwrapExpression(expression);
  return (
    ts.isObjectLiteralExpression(value) &&
    value.properties.some((property) => {
      if (!ts.isPropertyAssignment(property)) return false;
      const name = property.name;
      const key = ts.isComputedPropertyName(name)
        ? ts.isStringLiteral(name.expression) ? name.expression : undefined
        : name;
      return !!key && (ts.isIdentifier(key) || ts.isStringLiteral(key)) &&
        key.text === "success" &&
        unwrapExpression(property.initializer).kind === ts.SyntaxKind.FalseKeyword;
    })
  );
}

function isReturnedFailure(expression: ts.Expression, returned: ts.ReturnStatement): boolean {
  const value = unwrapExpression(expression);
  if (isFailureLiteral(value)) return true;
  if (ts.isConditionalExpression(value)) {
    return isReturnedFailure(value.whenTrue, returned) || isReturnedFailure(value.whenFalse, returned);
  }
  if (!ts.isIdentifier(value)) return false;
  // Only direct declarations in the return's own block, before the return.
  for (let block = returned.parent; block; block = block.parent) {
    if (ts.isFunctionLike(block)) return false;
    if (!ts.isBlock(block)) continue;
    return block.statements.some((statement) =>
      statement.getStart() < returned.getStart() && ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === value.text &&
        !!declaration.initializer && isFailureLiteral(declaration.initializer),
      ),
    );
  }
  return false;
}

function containsErrorAccess(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === "error") return true;
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    const key = unwrapExpression(node.argumentExpression);
    if (ts.isStringLiteral(key) && key.text === "error") return true;
  }
  return ts.forEachChild(node, containsErrorAccess) ?? false;
}

/** Syntactic sites, including unused named org-context imports. */
export function findActionBoundarySites(
  source: string,
  file: string,
): ActionBoundaryViolation[] {
  const inActions = file.startsWith("src/fn/") && SOURCE_EXTENSIONS.has(extname(file));
  const inHooks = file.startsWith("src/hooks/") && SOURCE_EXTENSIONS.has(extname(file));
  if ((!inActions && !inHooks) || TEST_FILE.test(file) || file.split("/").includes("__tests__")) return [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: ActionBoundaryViolation[] = [];
  const report = (node: ts.Node, kind: ActionBoundaryKind, message: string) => {
    sites.push({
      file,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      function: enclosingFunction(node),
      kind,
      message: `${message} ${DOC_POINTER}`,
    });
  };

  const orgImports = new Map<string, ts.ImportSpecifier>();
  const orgNamespaces = new Set<string>();
  const failureImports = new Set<string>();
  const failureNamespaces = new Set<string>();
  const calledOrgImports = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.isTypeOnly) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const isAuthModule = AUTH_MODULES.has(moduleSpecifier) || RELATIVE_AUTH_MODULE.test(moduleSpecifier);
    const isFailureModule = FAILURE_MODULES.has(moduleSpecifier) || RELATIVE_FAILURE_MODULE.test(moduleSpecifier);
    if (!isAuthModule && !isFailureModule) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      if (isAuthModule) orgNamespaces.add(bindings.name.text);
      if (isFailureModule) failureNamespaces.add(bindings.name.text);
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if (binding.isTypeOnly) continue;
        const importedName = (binding.propertyName ?? binding.name).text;
        if (isAuthModule && ORG_CONTEXT_NAMES.has(importedName)) {
          orgImports.set(binding.name.text, binding);
        }
        if (isFailureModule && importedName === FAILURE_NAME) failureImports.add(binding.name.text);
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (inActions) {
      if (file !== BOUNDARY_FILE && ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression);
        const direct = ts.isIdentifier(callee) &&
          (orgImports.has(callee.text) || ORG_CONTEXT_NAMES.has(callee.text));
        const namespaced = ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) && orgNamespaces.has(callee.expression.text) &&
          ORG_CONTEXT_NAMES.has(callee.name.text);
        if (direct || namespaced) {
          if (ts.isIdentifier(callee)) calledOrgImports.add(callee.text);
          report(node, "org-context", `Use withAction instead of calling ${callee.getText()}().`);
        }
        const directFailure = ts.isIdentifier(callee) &&
          (callee.text === FAILURE_NAME || failureImports.has(callee.text));
        const namespacedFailure = ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) && failureNamespaces.has(callee.expression.text) &&
          callee.name.text === FAILURE_NAME;
        if (file !== FAILURE_FILE && (directFailure || namespacedFailure)) {
          report(node, "action-failure", `Use withAction instead of calling ${callee.getText()}().`);
        }
      }
      if (
        ts.isReturnStatement(node) && node.expression &&
        returnedFromCatch(node) && isReturnedFailure(node.expression, node)
      ) {
        report(node, "catch-failure", "Use withAction instead of returning a hand-built ActionResult failure from catch.");
      }
    }
    if (inHooks && ts.isThrowStatement(node)) {
      const value = unwrapExpression(node.expression);
      if (
        (ts.isNewExpression(value) || ts.isCallExpression(value)) && ts.isIdentifier(value.expression) &&
        value.expression.text === "Error" && value.arguments?.[0] && containsErrorAccess(value.arguments[0])
      ) {
        report(node, "hook-unwrap", "Use unwrap() instead of throwing Error with a result.error argument.");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (inActions && file !== BOUNDARY_FILE) {
    for (const [localName, binding] of orgImports) {
      if (!calledOrgImports.has(localName)) {
        report(binding, "org-context", `Use withAction instead of importing ${(binding.propertyName ?? binding.name).text}.`);
      }
    }
  }
  return sites;
}

/** Match exceptions by file, function and kind; reject growth and stale counts. */
export function checkActionBoundaries(
  sources: readonly { file: string; source: string }[],
  allowlist: readonly ActionBoundaryException[] = ACTION_BOUNDARY_ALLOWLIST,
): ActionBoundaryViolation[] {
  const sites = sources.flatMap(({ file, source }) => findActionBoundarySites(source, file));
  const matches = (site: ActionBoundaryViolation, entry: ActionBoundaryException) =>
    site.file === entry.file && site.function === entry.function;
  const violations = sites.filter((site) => !allowlist.some((entry) => matches(site, entry)));
  for (const entry of allowlist) {
    for (const kind of SITE_KINDS) {
      const expected = entry.sites[kind] ?? 0;
      const matchingSites = sites.filter((site) => matches(site, entry) && site.kind === kind);
      const actual = matchingSites.length;
      if (actual > expected) {
        for (const site of matchingSites.slice(expected)) {
          violations.push({
            ...site,
            message: `Allowlist growth (${kind}): expected ${expected} site(s), found ${actual}. ${site.message}`,
          });
        }
      } else if (actual < expected) {
        violations.push({
          file: entry.file,
          line: 1,
          function: entry.function,
          kind,
          message: `Stale allowlist entry (${kind}): expected ${expected} site(s), found ${actual}. ${entry.reason} ${DOC_POINTER}`,
        });
      }
    }
  }
  return violations;
}

export function walkSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : walkSourceFiles(path);
    }
    return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

function main(): void {
  const root = process.cwd();
  const files = [
    ...walkSourceFiles(join(root, "src/fn")),
    ...walkSourceFiles(join(root, "src/hooks")),
  ];
  const violations = checkActionBoundaries(files.map((file) => ({
    file: relative(root, file),
    source: readFileSync(file, "utf8"),
  })));
  if (violations.length === 0) {
    console.log(`check:action-boundaries: ${files.length} files checked, no unallowlisted sites or stale entries.`);
    return;
  }
  console.error(`check:action-boundaries: ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line} ${violation.function}: ${violation.message}`);
  }
  process.exitCode = 1;
}

// Tests import the detector without running the repository scan.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
