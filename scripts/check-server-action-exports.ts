/**
 * Guard the Server Action boundary: a `"use server"` module must export only
 * actions that resolve their own organization context from the session.
 *
 * Next.js turns every export of a `"use server"` module into a public,
 * POST-callable action whose arguments come from the browser. An export that
 * accepts an `OrgContext` (or anything shaped like one) lets any signed-in
 * user forge `organizationId`/`isPlatformAdmin`, because `requireOrgScope`
 * only checks that the strings are non-empty and `requireOrgRole` trusts
 * `ctx.isPlatformAdmin`. Trusted-context implementations belong in
 * directive-free `src/fn/**\/*-core.ts` modules (docs/architecture.md).
 *
 * This check uses the TypeScript type checker, not grep, so aliases,
 * re-exports (`export { x } from`, `export *`), wrapped exports, rest
 * parameters and structural context types are all resolved. It fails on any
 * export of a `"use server"` module (and any inline `"use server"` function)
 * with a parameter that is:
 *
 * - context-shaped: an object type (or union member) with an
 *   `organizationId` property, directly or one property deep. This covers
 *   `OrgContext` and every alias or structural copy of it;
 * - a database or transaction handle (a Drizzle `db`/`tx`, a pg client);
 * - a rest parameter typed `Parameters<…>` / `ConstructorParameters<…>`, which
 *   forwards whatever the wrapped core accepts.
 *
 * It also fails when `requireOrgRole` or `requireOrgScope` is applied to a
 * parameter inside a `"use server"` module, unless that parameter belongs to an
 * inline callback (the `withAction(async (ctx) => …)` pattern, where the
 * context was resolved from the session).
 *
 * Waiver: a `// server-action-ok: <reason>` comment directly above the export
 * (or the guard call). The reason text is required. Use it only for a
 * parameter the browser genuinely owns (for example a form input that happens
 * to carry an `organizationId` the action re-checks against the session).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_FILE = /\.test\.tsx?$/;
const USE_SERVER = "use server";
const WAIVER = /\/\/\s*server-action-ok:\s*\S/;
const CONTEXT_PROPERTY = "organizationId";
const GUARD_NAMES = new Set(["requireOrgRole", "requireOrgScope"]);
const FORWARDING_UTILITY_TYPES = new Set([
  "Parameters",
  "ConstructorParameters",
]);
/** Members that together identify a Drizzle database or transaction. */
const DB_HANDLE_MEMBERS = ["select", "insert", "execute"] as const;
/** Members that together identify a raw pg client or pool. */
const PG_CLIENT_MEMBERS = ["query", "release"] as const;
/** How far into a parameter's properties a context shape is searched. */
const NESTED_PROPERTY_DEPTH = 1;

export interface ServerActionViolation {
  file: string;
  line: number;
  name: string;
  reason: string;
}

function hasUseServerPrologue(statements: ts.NodeArray<ts.Statement>): boolean {
  for (const statement of statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === USE_SERVER) return true;
  }
  return false;
}

function isInlineServerFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  if (
    !(
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) ||
    !node.body ||
    !ts.isBlock(node.body)
  ) {
    return false;
  }
  return hasUseServerPrologue(node.body.statements);
}

function hasWaiver(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const text = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  return ranges.some((range) => WAIVER.test(text.slice(range.pos, range.end)));
}

/** The statement (or export specifier) whose leading comments carry a waiver. */
function waiverAnchor(node: ts.Node): ts.Node {
  let current: ts.Node = node;
  while (
    current.parent &&
    !ts.isSourceFile(current.parent) &&
    !ts.isExportSpecifier(current) &&
    !ts.isStatement(current)
  ) {
    current = current.parent;
  }
  return current;
}

function lineOf(node: ts.Node): number {
  const sourceFile = node.getSourceFile();
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function withoutNullish(type: ts.Type): ts.Type[] {
  const members = type.isUnion() ? type.types : [type];
  return members.filter(
    (member) =>
      !(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)),
  );
}

function typeHasMembers(
  checker: ts.TypeChecker,
  type: ts.Type,
  members: readonly string[],
): boolean {
  return members.every((member) => checker.getPropertyOfType(type, member));
}

class ParameterInspector {
  constructor(private readonly checker: ts.TypeChecker) {}

  /** Why this parameter type must never cross the action boundary, if at all. */
  describe(type: ts.Type, depth = 0): string | null {
    for (const member of withoutNullish(type)) {
      const reason = this.describeMember(member, depth);
      if (reason) return reason;
    }
    return null;
  }

  private describeMember(type: ts.Type, depth: number): string | null {
    const { checker } = this;
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
    if (type.isIntersection()) {
      for (const part of type.types) {
        const reason = this.describeMember(part, depth);
        if (reason) return reason;
      }
      return null;
    }
    // Functions cannot be serialized from the browser, so a callback
    // parameter (withAction's `fn`) is not a forged-input channel.
    if (
      type.getCallSignatures().length > 0 &&
      type.getProperties().length === 0
    ) {
      return null;
    }
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      for (const element of checker.getTypeArguments(type as ts.TypeReference)) {
        const reason = this.describe(element, depth);
        if (reason) return reason;
      }
      return null;
    }
    if (!(type.flags & ts.TypeFlags.Object)) return null;

    if (checker.getPropertyOfType(type, CONTEXT_PROPERTY)) {
      return `accepts a caller-supplied organization context (${checker.typeToString(type)})`;
    }
    if (
      typeHasMembers(checker, type, DB_HANDLE_MEMBERS) ||
      typeHasMembers(checker, type, PG_CLIENT_MEMBERS)
    ) {
      return `accepts a database or transaction handle (${checker.typeToString(type)})`;
    }
    if (depth < NESTED_PROPERTY_DEPTH) {
      for (const property of checker.getPropertiesOfType(type)) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        if (!declaration) continue;
        const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
        const reason = this.describe(propertyType, depth + 1);
        if (reason) return `property "${property.name}" ${reason}`;
      }
    }
    return null;
  }
}

function forwardingRestType(declaration: ts.ParameterDeclaration): string | null {
  if (!declaration.dotDotDotToken || !declaration.type) return null;
  const typeNode = declaration.type;
  if (
    ts.isTypeReferenceNode(typeNode) &&
    FORWARDING_UTILITY_TYPES.has(typeNode.typeName.getText())
  ) {
    return typeNode.getText();
  }
  return null;
}

function checkSignatureParameters(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  signature: ts.Signature,
  location: ts.Node,
): string | null {
  for (const parameter of signature.getParameters()) {
    const declaration = parameter.valueDeclaration;
    if (declaration && ts.isParameter(declaration)) {
      const forwarded = forwardingRestType(declaration);
      if (forwarded) {
        return `forwards a rest parameter typed ${forwarded}`;
      }
    }
    const type = checker.getTypeOfSymbolAtLocation(
      parameter,
      declaration ?? location,
    );
    const reason = inspector.describe(type);
    if (reason) return `parameter "${parameter.name}" ${reason}`;
  }
  return null;
}

function checkCallableType(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  type: ts.Type,
  location: ts.Node,
): string | null {
  for (const signature of type.getCallSignatures()) {
    const reason = checkSignatureParameters(checker, inspector, signature, location);
    if (reason) return reason;
  }
  return null;
}

/** Where an export is declared in the "use server" module itself. */
function exportSite(
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
): ts.Node {
  const local = symbol.declarations?.find(
    (declaration) => declaration.getSourceFile() === sourceFile,
  );
  if (local) return local;
  // `export *` has no per-name declaration in this file; anchor on the star.
  const star = sourceFile.statements.find(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      !statement.exportClause &&
      statement.moduleSpecifier,
  );
  return star ?? sourceFile.statements[0] ?? sourceFile;
}

function isInlineCallback(fn: ts.Node): boolean {
  if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false;
  let parent = fn.parent;
  while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return (
    !!parent &&
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    (parent.arguments ?? []).some((argument) => argument === fn || argument.pos === fn.pos)
  );
}

function calleeName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/** Strips `as`, `!`, `satisfies`, type assertions and parentheses. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function checkGuardCalls(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  report: (node: ts.Node, name: string, reason: string) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const first = node.arguments[0] && unwrapExpression(node.arguments[0]);
      if (name && GUARD_NAMES.has(name) && first && ts.isIdentifier(first)) {
        const symbol = checker.getSymbolAtLocation(first);
        const declaration = symbol?.valueDeclaration;
        if (
          declaration &&
          ts.isParameter(declaration) &&
          !isInlineCallback(declaration.parent)
        ) {
          report(
            node,
            name,
            `${name}() is applied to the parameter "${first.text}", so the context comes from the caller rather than the session`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function checkInlineServerFunctions(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  sourceFile: ts.SourceFile,
  report: (node: ts.Node, name: string, reason: string) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (isInlineServerFunction(node)) {
      const signature = checker.getSignatureFromDeclaration(node);
      const reason = signature
        ? checkSignatureParameters(checker, inspector, signature, node)
        : null;
      if (reason) {
        const name =
          node.name && ts.isIdentifier(node.name) ? node.name.text : "(inline action)";
        report(node, name, reason);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/** Checks every `"use server"` module and inline server function in `program`. */
export function findServerActionViolations(
  program: ts.Program,
  rootFiles: readonly string[],
  root: string,
): ServerActionViolation[] {
  const checker = program.getTypeChecker();
  const inspector = new ParameterInspector(checker);
  const violations: ServerActionViolation[] = [];

  for (const fileName of rootFiles) {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) continue;
    const report = (node: ts.Node, name: string, reason: string) => {
      if (hasWaiver(waiverAnchor(node), sourceFile)) return;
      violations.push({
        file: relative(root, sourceFile.fileName),
        line: lineOf(node),
        name,
        reason,
      });
    };

    checkInlineServerFunctions(checker, inspector, sourceFile, report);
    if (!hasUseServerPrologue(sourceFile.statements)) continue;

    checkGuardCalls(checker, sourceFile, report);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const target =
        exported.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      // Type-only exports never reach the action manifest.
      if (!(target.flags & ts.SymbolFlags.Value)) continue;
      const site = exportSite(exported, sourceFile);
      const declaration = target.valueDeclaration ?? target.declarations?.[0] ?? site;
      const type = checker.getTypeOfSymbolAtLocation(target, declaration);
      const reason = checkCallableType(checker, inspector, type, declaration);
      if (reason) report(site, exported.name, reason);
    }
  }

  return violations;
}

function walkSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "generated" ? [] : walkSourceFiles(path);
    }
    return SCANNED_EXTENSIONS.has(extname(entry.name)) &&
      !TEST_FILE.test(entry.name)
      ? [path]
      : [];
  });
}

/** Files that declare a server boundary: cheap text filter, AST decides. */
export function findServerBoundaryFiles(directory: string): string[] {
  return walkSourceFiles(directory).filter((file) =>
    readFileSync(file, "utf8").includes(USE_SERVER),
  );
}

export function loadCompilerOptions(root: string): ts.CompilerOptions {
  const configPath = join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
  );
  return { ...parsed.options, noEmit: true, incremental: false };
}

/** Builds a program rooted only at the boundary files and checks it. */
export function checkServerActionExports(
  root: string,
  files: readonly string[],
  options: ts.CompilerOptions = loadCompilerOptions(root),
): ServerActionViolation[] {
  const rootFiles = files.map((file) => resolve(file));
  const program = ts.createProgram({ rootNames: rootFiles, options });
  return findServerActionViolations(program, rootFiles, root);
}

function main(): void {
  const root = process.cwd();
  const files = findServerBoundaryFiles(join(root, "src"));
  const violations = checkServerActionExports(root, files);

  if (violations.length === 0) {
    console.log(
      `check:server-action-exports — ${files.length} files mentioning "use server" checked, no trusted-context exports.`,
    );
    return;
  }

  console.error(
    `check:server-action-exports — ${violations.length} unsafe Server Action export(s):\n`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line}  ${violation.name}\n      ${violation.reason}`,
    );
  }
  console.error(
    "\nEvery export of a \"use server\" module is a public action the browser can\n" +
      "call with any arguments. Move trusted-context code into a directive-free\n" +
      "src/fn/**/*-core.ts module and export only actions that resolve their own\n" +
      "context (withAction). See docs/architecture.md.",
  );
  process.exitCode = 1;
}

// Run only when invoked as a script; the test imports the checker.
if (process.argv[1]?.includes("check-server-action-exports")) main();
