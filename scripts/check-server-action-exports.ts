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
 * directive-free modules, conventionally `src/fn/**\/*-core.ts`
 * (docs/architecture.md).
 *
 * This check uses the TypeScript type checker, not grep, so aliases,
 * generics, re-exports (`export { x } from`, `export *`), wrapped exports,
 * rest parameters and structural context types are all resolved. It fails on
 * any export of a `"use server"` module (and any inline `"use server"`
 * function) with a parameter that is:
 *
 * - context-shaped: an object type (or union/intersection member, array
 *   element, or generic constraint) with an `organizationId`, `orgRole` or
 *   `isPlatformAdmin` property, directly or up to a few properties deep. This
 *   covers `OrgContext`, its aliases, `Omit<>`/`Pick<>` slices and structural
 *   copies;
 * - a raw tenant id: a parameter or nested property named `organizationId`
 *   or `orgId`. An action learns its organization from the session;
 * - a database or transaction handle (a Drizzle `db`/`tx`, a pg client);
 * - a rest parameter typed `Parameters<…>` / `ConstructorParameters<…>`, which
 *   forwards whatever the wrapped core accepts.
 *
 * It also fails when `requireOrgRole` or `requireOrgScope` (however imported
 * or aliased) is applied to a value derived from a parameter, through casts,
 * property access or a local initialised from it, inside a `"use server"`
 * module or inline server function. The one allowed shape is a parameter of an
 * inline callback (the `withAction(async (ctx) => …)` pattern), where the
 * context was resolved from the session.
 *
 * There is no waiver: fix the export, do not suppress it. `unknown`/`any`
 * inputs stay allowed because they are ordinary action input; casting one to a
 * context and guarding it is caught by the guard rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_FILE = /\.test\.tsx?$/;
const USE_SERVER = "use server";
/** Any one of these properties makes an object type an organization context. */
const CONTEXT_PROPERTIES = ["organizationId", "orgRole", "isPlatformAdmin"];
/** Parameter or property names that carry a raw tenant id. */
const TENANT_ID_NAMES = new Set(["organizationId", "orgId"]);
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
const NESTED_PROPERTY_DEPTH = 3;
/** How many local aliases (`const c = input as Ctx`) a guard argument is followed through. */
const MAX_ALIAS_HOPS = 5;

export interface ServerActionViolation {
  file: string;
  line: number;
  name: string;
  reason: string;
}

type Report = (node: ts.Node, name: string, reason: string) => void;

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

function isInlineServerFunction(
  node: ts.Node,
): node is ts.FunctionLikeDeclaration & { body: ts.Block } {
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
  describe(type: ts.Type, depth = 0, seen = new Set<ts.Type>()): string | null {
    for (const member of withoutNullish(type)) {
      const reason = this.describeMember(member, depth, seen);
      if (reason) return reason;
    }
    return null;
  }

  private describeMember(
    type: ts.Type,
    depth: number,
    seen: Set<ts.Type>,
  ): string | null {
    const { checker } = this;
    if (seen.has(type)) return null;
    seen.add(type);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      return constraint && constraint !== type
        ? this.describe(constraint, depth, seen)
        : null;
    }
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) {
        const reason = this.describeMember(part, depth, seen);
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
        const reason = this.describe(element, depth, seen);
        if (reason) return reason;
      }
      return null;
    }
    if (!(type.flags & ts.TypeFlags.Object)) return null;

    const contextProperty = CONTEXT_PROPERTIES.find((name) =>
      checker.getPropertyOfType(type, name),
    );
    if (contextProperty) {
      return `accepts a caller-supplied organization context (${checker.typeToString(type)} has "${contextProperty}")`;
    }
    if (
      typeHasMembers(checker, type, DB_HANDLE_MEMBERS) ||
      typeHasMembers(checker, type, PG_CLIENT_MEMBERS)
    ) {
      return `accepts a database or transaction handle (${checker.typeToString(type)})`;
    }
    if (depth < NESTED_PROPERTY_DEPTH) {
      for (const property of checker.getPropertiesOfType(type)) {
        if (TENANT_ID_NAMES.has(property.name)) {
          return `property "${property.name}" accepts a raw tenant id`;
        }
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        if (!declaration) continue;
        const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
        const reason = this.describe(propertyType, depth + 1, seen);
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
    if (TENANT_ID_NAMES.has(parameter.name)) {
      return `parameter "${parameter.name}" accepts a raw tenant id`;
    }
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

/** A session-resolved callback: an inline function passed as a call argument. */
function isInlineCallback(fn: ts.Node): boolean {
  if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false;
  if (isInlineServerFunction(fn)) return false;
  let parent = fn.parent;
  while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return (
    !!parent &&
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    (parent.arguments ?? []).some((argument) => argument === fn || argument.pos === fn.pos)
  );
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

/** Strips casts and property/element access down to the root expression. */
function rootExpression(expression: ts.Expression): ts.Expression {
  let current = unwrapExpression(expression);
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    current = unwrapExpression(current.expression);
  }
  return current;
}

/** The resolved name of a call's callee, following import aliases. */
function resolvedCalleeName(
  checker: ts.TypeChecker,
  callee: ts.LeftHandSideExpression,
): string | null {
  const nameNode = ts.isIdentifier(callee)
    ? callee
    : ts.isPropertyAccessExpression(callee)
      ? callee.name
      : null;
  if (!nameNode) return null;
  const symbol = checker.getSymbolAtLocation(nameNode);
  if (!symbol) return nameNode.text;
  const target =
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return target.name;
}

/**
 * The parameter a guard argument derives from, following casts, property
 * access and locals initialised from another expression.
 */
function sourceParameter(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): ts.ParameterDeclaration | null {
  let current = rootExpression(expression);
  for (let hop = 0; hop < MAX_ALIAS_HOPS; hop += 1) {
    if (!ts.isIdentifier(current)) return null;
    const declaration = checker.getSymbolAtLocation(current)?.valueDeclaration;
    if (!declaration) return null;
    if (ts.isParameter(declaration)) return declaration;
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isIdentifier(declaration.name)
    ) {
      current = rootExpression(declaration.initializer);
      continue;
    }
    if (ts.isBindingElement(declaration)) {
      // `const { ctx } = input`: follow the destructured source.
      let binding: ts.Node = declaration.parent;
      while (ts.isBindingElement(binding) || ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
        binding = binding.parent;
      }
      if (ts.isParameter(binding)) return binding;
      if (ts.isVariableDeclaration(binding) && binding.initializer) {
        current = rootExpression(binding.initializer);
        continue;
      }
    }
    return null;
  }
  return null;
}

function checkGuardCalls(
  checker: ts.TypeChecker,
  root: ts.Node,
  report: Report,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = resolvedCalleeName(checker, node.expression);
      const [first] = node.arguments;
      if (name && GUARD_NAMES.has(name) && first) {
        const parameter = sourceParameter(checker, first);
        if (parameter && !isInlineCallback(parameter.parent)) {
          report(
            node,
            name,
            `${name}() is applied to the parameter "${parameter.name.getText()}", so the context comes from the caller rather than the session`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}

function checkInlineServerFunctions(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  sourceFile: ts.SourceFile,
  moduleIsServer: boolean,
  report: Report,
): void {
  const visit = (node: ts.Node): void => {
    if (isInlineServerFunction(node)) {
      const signature = checker.getSignatureFromDeclaration(node);
      const reason = signature
        ? checkSignatureParameters(checker, inspector, signature, node)
        : null;
      const name =
        node.name && ts.isIdentifier(node.name) ? node.name.text : "(inline action)";
      if (reason) report(node, name, reason);
      // A server module's guard pass already covers the whole file.
      if (!moduleIsServer) checkGuardCalls(checker, node.body, report);
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
    const report: Report = (node, name, reason) => {
      violations.push({
        file: relative(root, sourceFile.fileName),
        line: lineOf(node),
        name,
        reason,
      });
    };

    const moduleIsServer = hasUseServerPrologue(sourceFile.statements);
    checkInlineServerFunctions(checker, inspector, sourceFile, moduleIsServer, report);
    if (!moduleIsServer) continue;

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
      "module (conventionally src/fn/**/*-core.ts) and export only actions that\n" +
      "resolve their own context (withAction). See docs/architecture.md.",
  );
  process.exitCode = 1;
}

// Run only when invoked as a script; the test imports the checker.
if (process.argv[1]?.includes("check-server-action-exports")) main();
