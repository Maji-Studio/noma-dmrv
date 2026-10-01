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
 *   element, index-signature value, or generic constraint) with an
 *   `organizationId`, `orgRole` or `isPlatformAdmin` property, at any depth.
 *   This covers `OrgContext`, its aliases, `Omit<>`/`Pick<>` slices and
 *   structural copies;
 * - a raw tenant id: a parameter or nested property named `organizationId`
 *   or `orgId`. An action learns its organization from the session;
 * - a database or transaction handle (a Drizzle `db`/`tx`, a pg client);
 * - a rest parameter typed `Parameters<…>` / `ConstructorParameters<…>`, which
 *   forwards whatever the wrapped core accepts.
 *
 * It also fails when `requireOrgRole` or `requireOrgScope` (however imported
 * or aliased) is applied to a value derived from a parameter, through casts,
 * property access or a local initialised from it, inside a `"use server"`
 * module or inline server function. The one allowed shape is the first
 * parameter of the callback passed to `withAction(async (ctx) => …)`, which
 * `withAction` resolves from the session. Any other callback parameter
 * (`contexts.map((ctx) => requireOrgRole(ctx, …))`) may carry caller input.
 *
 * Inside those same bodies it fails on a type assertion (`as`, `<T>x`,
 * `satisfies`), annotated local or assignment that gives a context shape to a
 * value derived from a parameter other than withAction's session context, to
 * an `any` value, or (for assertions) to a value whose own type lacks that
 * shape: `core(input as OrgContext)`, `{ ...(input as OrgContext) }`,
 * `let ctx: OrgContext; ctx = input as OrgContext`. It also fails on a call
 * argument that implicitly converts an `any` (the value, or a property or
 * array element of it) into a context-shaped parameter:
 * `core(JSON.parse(raw))`, `core({ scope: input })` with `input: any`, into
 * any tuple element or index-signature value of such a parameter, and through
 * spreads, `.call`/`.apply`/`.bind` and generic forwarding, which are checked
 * against the declared parameters of the function actually invoked
 * (scripts/server-action-call-targets.ts). Guard callees are resolved through
 * import aliases and local aliases (`const check = requireOrgRole`).
 *
 * There is no waiver: fix the export, do not suppress it. `unknown`/`any`
 * inputs stay allowed because they are ordinary action input; turning one into
 * a context, by cast, annotation, assignment or call argument, is caught.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import {
  declaredParameterFindings,
  invokedFunction,
} from "./server-action-call-targets";
import {
  carriesAnyContext,
  ParameterInspector,
  TENANT_ID_NAMES,
  unwrapExpression,
} from "./server-action-types";

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_FILE = /\.test\.tsx?$/;
const USE_SERVER = "use server";
const GUARD_NAMES = new Set(["requireOrgRole", "requireOrgScope"]);
/** Wrappers that call their callback with a session-resolved OrgContext. */
const SESSION_CONTEXT_WRAPPERS = new Set(["withAction"]);
const FORWARDING_UTILITY_TYPES = new Set([
  "Parameters",
  "ConstructorParameters",
]);
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
  let symbol = checker.getSymbolAtLocation(nameNode);
  if (!symbol) return nameNode.text;
  // Follow import aliases and `const check = requireOrgRole` style locals.
  for (let hop = 0; hop < MAX_ALIAS_HOPS; hop += 1) {
    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
      continue;
    }
    const declaration = symbol.valueDeclaration;
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !declaration.initializer
    ) {
      break;
    }
    const initializer = unwrapExpression(declaration.initializer);
    const next = ts.isPropertyAccessExpression(initializer)
      ? checker.getSymbolAtLocation(initializer.name)
      : ts.isIdentifier(initializer)
        ? checker.getSymbolAtLocation(initializer)
        : undefined;
    if (!next) break;
    symbol = next;
  }
  return symbol.name;
}

/**
 * True only for the first parameter of the callback handed to `withAction`,
 * the one parameter whose value comes from the session.
 */
function isSessionContextParameter(
  checker: ts.TypeChecker,
  parameter: ts.ParameterDeclaration,
): boolean {
  const fn = parameter.parent;
  if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false;
  if (fn.parameters[0] !== parameter) return false;
  let argument: ts.Node = fn;
  while (ts.isParenthesizedExpression(argument.parent)) argument = argument.parent;
  const call = argument.parent;
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== argument) {
    return false;
  }
  const wrapper = resolvedCalleeName(checker, call.expression);
  return !!wrapper && SESSION_CONTEXT_WRAPPERS.has(wrapper);
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

/** True when `expression` is (a copy of) the withAction callback's context. */
function isSessionContext(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): boolean {
  const parameter = sourceParameter(checker, expression);
  return !!parameter && isSessionContextParameter(checker, parameter);
}

/**
 * Why giving `value` the type `targetType` manufactures an organization
 * context (or db handle) inside a server boundary, if it does. The value is
 * suspect when it derives from a parameter other than withAction's session
 * context, or is `any` (TypeScript checked nothing). A type assertion is also
 * suspect when it asserts a context shape the value's own type lacks
 * (`input as OrgContext`); re-typing a value that already has that shape (a
 * row, the session context) is not a conversion.
 */
function contextConversion(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  value: ts.Expression,
  targetType: ts.Type,
  isAssertion: boolean,
): string | null {
  const reason = inspector.describe(targetType);
  if (!reason) return null;
  if (isSessionContext(checker, value)) return null;
  if (sourceParameter(checker, value)) return reason;
  const valueType = checker.getTypeAtLocation(unwrapExpression(value));
  if (carriesAnyContext(checker, inspector, valueType, targetType)) return reason;
  return isAssertion && !inspector.describe(valueType) ? reason : null;
}

function isTypeConversion(
  node: ts.Node,
): node is ts.AsExpression | ts.TypeAssertion | ts.SatisfiesExpression {
  return (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

function checkContextConversions(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  node: ts.Node,
  report: Report,
): void {
  if (isTypeConversion(node) && !ts.isConstTypeReference(node.type)) {
    const reason = contextConversion(
      checker,
      inspector,
      node.expression,
      checker.getTypeFromTypeNode(node.type),
      true,
    );
    if (reason) {
      report(node, node.type.getText(), `type assertion ${reason}`);
    }
    return;
  }
  if (ts.isVariableDeclaration(node) && node.type && node.initializer) {
    const reason = contextConversion(
      checker,
      inspector,
      node.initializer,
      checker.getTypeFromTypeNode(node.type),
      false,
    );
    if (reason) {
      report(node, node.name.getText(), `annotated local ${reason}`);
    }
    return;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    const reason = contextConversion(
      checker,
      inspector,
      node.right,
      checker.getTypeAtLocation(node.left),
      false,
    );
    if (reason) {
      report(node, node.left.getText(), `assignment ${reason}`);
    }
  }
}

/**
 * Call arguments convert implicitly: `core(JSON.parse(raw))` or
 * `core({ scope: input })` with `input: any` hands the core a context no
 * cast, annotation or guard ever touched. Parameter-derived values that are
 * not `any` need a cast to fit a context slot, which the assertion rule
 * catches, so only `any` is checked here. Each argument is checked against
 * its contextual type and against the declared parameter of the function
 * actually invoked (through spreads, `.call`/`.apply`/`.bind` and generics).
 */
function checkCallArguments(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  call: ts.CallExpression | ts.NewExpression,
  skip: ts.Expression | undefined,
  report: Report,
): void {
  const findings = new Map<ts.Expression, string>();
  for (const argument of call.arguments ?? []) {
    if (argument === skip || ts.isSpreadElement(argument)) continue;
    const targetType = checker.getContextualType(argument);
    if (
      !targetType ||
      isSessionContext(checker, argument) ||
      !carriesAnyContext(
        checker,
        inspector,
        checker.getTypeAtLocation(argument),
        targetType,
      )
    ) {
      continue;
    }
    findings.set(argument, inspector.describe(targetType) ?? "");
  }
  const invoked = invokedFunction(checker, call);
  if (invoked) {
    for (const [argument, reason] of declaredParameterFindings(
      checker,
      inspector,
      call,
      invoked,
      (argument) =>
        argument === skip ||
        isSessionContext(
          checker,
          ts.isSpreadElement(argument) ? argument.expression : argument,
        ),
    )) {
      if (!findings.has(argument)) findings.set(argument, reason);
    }
  }
  for (const [argument, reason] of findings) {
    report(
      argument,
      argument.getText(),
      `call argument passes an \`any\` value into ${reason}`,
    );
  }
}

/**
 * Checks a server boundary body (a "use server" module or an inline action):
 * guards applied to caller input, and casts, annotated locals or `any` call
 * arguments that turn caller input into an organization context.
 */
function checkServerBody(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  root: ts.Node,
  report: Report,
): void {
  const visit = (node: ts.Node): void => {
    checkContextConversions(checker, inspector, node, report);
    if (ts.isNewExpression(node)) {
      checkCallArguments(checker, inspector, node, undefined, report);
    }
    if (ts.isCallExpression(node)) {
      const name = resolvedCalleeName(checker, node.expression);
      const [first] = node.arguments;
      let guarded: ts.Expression | undefined;
      if (name && GUARD_NAMES.has(name) && first) {
        const parameter = sourceParameter(checker, first);
        if (parameter && !isSessionContextParameter(checker, parameter)) {
          guarded = first;
          report(
            node,
            name,
            `${name}() is applied to the parameter "${parameter.name.getText()}", so the context comes from the caller rather than the session`,
          );
        }
      }
      // A guard finding already covers its first argument.
      checkCallArguments(checker, inspector, node, guarded, report);
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
      // A server module's body pass already covers the whole file.
      if (!moduleIsServer) checkServerBody(checker, inspector, node.body, report);
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

    checkServerBody(checker, inspector, sourceFile, report);
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
