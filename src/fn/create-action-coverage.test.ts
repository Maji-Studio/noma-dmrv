import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const FN_ROOT = join(ROOT, "src/fn");
const TEST_FILE = /\.(test|spec)\.tsx?$/;
const NON_CREATE_VERBS = /^(get|list|search|fetch|load|preview|can|is|has|update|delete|archive|restore|unarchive|revoke|remove|set|change)(?=[A-Z]|$)/;
const API_KEY_ACTION = "api-keys#createApiKeyFn";
const WRAPPER_FILE = join(FN_ROOT, "with-create.ts");

const KEYED = [
  "samples#createSampleFn",
  "production-incidents#createProductionIncidentFn",
  "production-samples#createProductionSampleFn",
  "suppliers#createSupplierWithLocationsFn",
  "suppliers#createSupplierLocationFn",
  "customers#createCustomerWithLocationsFn",
  "customers#createCustomerLocationFn",
  "orders#createOrderFn",
  "feedstocks#createFeedstockFn",
  "production-runs#createProductionRunFn",
  "applications#createApplicationFn",
  "transport-legs#createTransportLegFn",
  "credit-batches#createCreditBatchFn",
  "formulations#createFormulationFn",
  "quick-add#createDriverFn",
  "quick-add#createOperatorFn",
  API_KEY_ACTION,
];

// Creates not yet keyed; see docs/open-questions.md. Wiring and client checks apply only to KEYED.
const PENDING = [
  "quick-add#createVehicleFn",
  "quick-add#createFeedstockTypeFn",
  "quick-add#createStorageLocationFn",
  "storage-locations#createStorageLocationFn",
  "facilities#createFacilityFn",
  "reactors#createReactorFn",
  "feedstock-types#createFeedstockTypeFn",
  "emission-entries#createEmissionEntryFn",
  "production-processes#startNewProductionProcessFn",
];

const EXCEPTION: Record<string, string> = {
  "deliveries#createDeliveryFn": "Stock posting carries its own domain idempotencyKey.",
  "biochar-products#createBiocharProductFn": "Stock posting carries its own domain idempotencyKey.",
  "output-stock#postOutputStockFn": "Stock posting carries its own domain idempotencyKey.",
  "bin-movements#recordLossFn": "Stock posting carries its own domain idempotencyKey.",
  "emission-entries#replaceEmissionEntryFn": "expectedVersion refuses stale replacement retries.",
  "certification/emission-zeros#recordEmissionZerosFn": "Reuses zero entries and checks the removal version.",
  "feedstock-types#importIsometricFeedstockTypeFn": "Refuses an already imported isometricFeedstockTypeId.",
  "organizations#createOrganizationAction": "Platform admin creation is guarded by the unique slug.",
  "invitation-bootstrap#bootstrapInvitationAccountAction": "Pre-sign-in bootstrap refuses an existing account.",
  "certification/create-removal-with-batches#createRemovalWithBatchesAction": "Rechecks ungrouped batches under row locks.",
  "certification/ghg-statements#createGhgStatementDraft": "External POST adopts or refuses a matching remote statement under a facility lock.",
  "certification/sources#mirrorDocumentToSource": "Reconciles external uploads and uses insert-or-get locally.",
  "organizations#inviteMemberAction": "Owner-approved retry replaces the pending invitation through Better Auth.",
  "documents#requestUpload": "Duplicates leave pending uploads reclaimed by the upload sweep; evidence create is single-flight.",
  "production-run-reading-imports#importProductionRunReadingsFromDocumentFn": "Seed-only unmounted importer deduplicates timestamps.",
  "bin-movements#recordStockTakeFn": "Legacy unmounted action; useRecordStockTake has no caller.",
  "certification/ghg-statement-reports#prepareGhgStatementReport": "Reuses preparationKey under certification artifact and facility locks.",
  "certification/ghg-statement-sync#reconcileGhgStatementsFromRegistry": "Adopts registry identities under the facility lock and submission ledger.",
  "certification/ghg-statements#submitGhgStatementToVerifier": "External submission uses the existing submission claim and reconciliation ledger.",
  "certification/storage-location-actions#syncApplicationStorageLocation": "Reuses or reconciles the remote supplier reference and rechecks registration under locks.",
  "organizations#acceptInvitationAction": "Better Auth consumes an existing invitation to establish membership.",
};

const NOT_CREATE: Record<string, string> = {
  "applications#getApplicationStatsFn": "Reads application totals without creating a domain record.",
  "customers#getCustomerStatsFn": "Reads customer totals without creating a domain record.",
  "facilities#getFacilityStatsFn": "Reads facility totals without creating a domain record.",
  "formulations#getFormulationStatsFn": "Reads formulation totals without creating a domain record.",
  "reactors#getReactorStatsFn": "Reads reactor totals without creating a domain record.",
  "suppliers#getSupplierStatsFn": "Reads supplier totals without creating a domain record.",
  "record-credit-batches#previewRecordCreditBatchesFn": "Previews credit batch membership without saving the record or creating batches.",
  "production-processes#recordMethodBPrerequisitesFn": "Updates an existing process prerequisite record.",
  "documents#confirmUpload": "Promotes an existing pending upload.",
  "bin-movements#removeLossFn": "Removes an existing loss.",
  "output-stock#removeOutputLossFn": "Removes an existing output loss.",
  "certification/emission-zeros#undoEmissionZerosFn": "Undoes existing zero entries.",
  "certification/facility-mapping#saveFacilityCertifierMapping": "Upserts the facility's provider mapping.",
  "certification/facility-mapping#saveFacilityEmissionConfig": "Updates facility emission defaults.",
  "certification/ghg-statement-reports#approveGhgStatementReport": "Approves an existing report version.",
  "certification/ghg-statements#refreshGhgStatementStatus": "Refreshes an existing registry statement's state.",
  "certification/removal-evidence-refresh#refreshInterruptedRemovalEvidence": "Updates metadata on an existing interrupted submission under its artifact lock.",
  "certification/removal-template-setup#applyRemovalTemplateSetup": "Applies settings and template assignments to existing facilities and batches.",
  "certification/source-visibility#saveRegistrySourceVisibility": "Updates organization Source visibility defaults.",
  "emission-entries#confirmEmissionEntryFn": "Confirms an existing emission entry.",
  "geo#geocodeAddressFn": "Looks up coordinates without creating a domain record.",
  "geo#reverseGeocodeFn": "Looks up an address without creating a domain record.",
  "geo#routeDistanceFn": "Reads a route distance through the geo cache.",
  "geo#routeGeometriesFn": "Reads route geometries through the geo cache.",
  "gis-boundary#normalizeGisBoundaryFn": "Normalizes supplied GeoJSON without persisting it.",
  "oauth#selectOAuthOrganizationFn": "Selects organization context for an existing OAuth attempt.",
  "organization-settings#saveOrganizationDefaults": "Upserts organization operating settings.",
  "transport-distance-refresh#refreshFeedstockDistanceFn": "Updates an existing feedstock's transport distance.",
  "transport-distance-refresh#refreshDeliveryDistanceFn": "Updates an existing delivery's transport distance.",
};

type Action = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function sourceFiles(directory: string): ts.SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !TEST_FILE.test(path)
      ? [ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true)]
      : [];
  });
}

function descendants(node: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  function visit(child: ts.Node) {
    nodes.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return nodes;
}

function isServerModule(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function exportedActions(source: ts.SourceFile): Map<string, Action> {
  const local = new Map<string, Action>();
  const exported = new Map<string, Action>();
  for (const statement of source.statements) {
    const entries: [string, Action][] = [];
    if (ts.isFunctionDeclaration(statement)) entries.push([statement.name?.text ?? "default", statement]);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
          entries.push([declaration.name.text, declaration.initializer]);
        }
      }
    }
    if (ts.isExportAssignment(statement)) {
      const value = statement.expression;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) exported.set("default", value);
      else if (!ts.isIdentifier(value)) throw new Error(`Classify default export in ${source.fileName}`);
    }
    if (ts.isVariableStatement(statement) && statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
      entries.length !== statement.declarationList.declarations.length) {
      throw new Error(`Cannot resolve exported action declaration in ${source.fileName}`);
    }
    for (const [name, fn] of entries) {
      local.set(name, fn);
      if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exported.set(ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : name, fn);
      }
    }
  }
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      const fn = local.get(statement.expression.text);
      if (!fn) throw new Error(`Cannot resolve default export in ${source.fileName}`);
      exported.set("default", fn);
    }
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    // Fail closed on re-exports rather than silently omit a new public action.
    if (statement.moduleSpecifier || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      throw new Error(`Classify re-exported actions in ${source.fileName}: ${statement.getText(source)}`);
    }
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      const fn = local.get((element.propertyName ?? element.name).text);
      if (!fn) throw new Error(`Cannot resolve exported action ${element.name.text} in ${source.fileName}`);
      exported.set(element.name.text, fn);
    }
  }
  return exported;
}

function moduleName(file: string): string {
  return relative(FN_ROOT, file).replace(/\.tsx?$/, "");
}

function namedCall(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}

function wiringErrors(identity: string, fn: Action): string[] {
  const errors: string[] = [];
  const intent = fn.parameters.find(parameter => parameter.type && ts.isTypeReferenceNode(parameter.type) &&
    ts.isIdentifier(parameter.type.typeName) && parameter.type.typeName.text === "CreateIntentOptions");
  if (!intent || !ts.isIdentifier(intent.name)) return ["Missing CreateIntentOptions parameter"];
  const intentName = intent.name.text;
  const calls = fn.body ? descendants(fn.body).filter(node => namedCall(node, "withCreate")) : [];
  if (calls.length !== 1) return ["Expected one withCreate call"];
  const call = calls[0];
  const options = call.arguments[1];
  if (!options || !ts.isIdentifier(options) || options.text !== intentName) errors.push("Intent must be argument 1");
  const callback = call.arguments[0];
  if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return [...errors, "Callback must be argument 0"];
  const create = callback.parameters[1];
  if (create && ts.isObjectBindingPattern(create.name) && identity !== API_KEY_ACTION) {
    return [...errors, "Only API keys may destructure create"];
  }
  if (!create || !ts.isIdentifier(create.name)) return [...errors, "Callback must declare create as parameter 1"];
  const createName = create.name.text;
  const nodes = descendants(callback.body);
  const runnerCalls = nodes.filter(node => namedCall(node, createName));
  const keyReads = nodes.filter(node =>
    ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isObjectBindingPattern(node.name) &&
      node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === createName) ||
    (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === createName && node.name.text === "key") ||
    (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === createName &&
      ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "key"));
  if (identity === API_KEY_ACTION) {
    if (keyReads.length === 0 || runnerCalls.length !== 0) errors.push("API keys must use create.key only");
  } else {
    if (runnerCalls.length !== 1) errors.push("Callback must call create once");
    if (keyReads.length !== 0) errors.push("Only API keys may read create.key");
  }
  return errors;
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;
}

function hasIntentProperty(node: ts.Node | undefined): boolean {
  return !!node && ts.isObjectLiteralExpression(node) && node.properties.some(property =>
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && propertyName(property.name) === "intentKey");
}

function clientErrors(source: ts.SourceFile): string[] {
  const bindings = new Map<string, string>();
  const namespaces = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    const file = specifier.startsWith("@/") ? resolve(ROOT, "src", specifier.slice(2))
      : specifier.startsWith(".") ? resolve(dirname(source.fileName), specifier) : undefined;
    if (!file || !file.startsWith(`${FN_ROOT}/`)) continue;
    const actionModule = moduleName(file);
    const imports = statement.importClause?.namedBindings;
    if (imports && ts.isNamedImports(imports)) {
      for (const binding of imports.elements) {
        if (!binding.isTypeOnly) bindings.set(binding.name.text, `${actionModule}#${(binding.propertyName ?? binding.name).text}`);
      }
    } else if (imports && ts.isNamespaceImport(imports)) namespaces.set(imports.name.text, actionModule);
  }
  const errors: string[] = [];
  for (const node of descendants(source)) {
    // Import declarations introduce bindings; type queries do not pass runtime values.
    let ancestor: ts.Node | undefined = node;
    while (ancestor && !ts.isImportDeclaration(ancestor) && !ts.isTypeQueryNode(ancestor)) ancestor = ancestor.parent;
    if (ancestor) continue;
    const identity = ts.isIdentifier(node) && bindings.has(node.text)
      ? bindings.get(node.text)
      : (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)
        ? `${namespaces.get(node.expression.text)}#${ts.isPropertyAccessExpression(node)
          ? node.name.text : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : ""}`
        : undefined;
    if (!identity || !KEYED.includes(identity)) continue;
    // A property name is not a reference to a same-named imported binding.
    if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) continue;
    const call = node.parent;
    if (!ts.isCallExpression(call) || call.expression !== node || !hasIntentProperty(call.arguments[1])) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      errors.push(`${relative(ROOT, source.fileName)}:${line + 1} ${identity} needs a direct call with { intentKey } as argument 1`);
    }
  }
  return errors;
}

const fnFiles = sourceFiles(FN_ROOT);
const actions = new Map<string, Action>(fnFiles.filter(isServerModule).flatMap(source =>
  [...exportedActions(source)].map(([name, fn]) => [`${moduleName(source.fileName)}#${name}`, fn] as const)));

it("classifies every create candidate exactly once and rejects stale entries", () => {
  const entries = [...KEYED, ...PENDING, ...Object.keys(EXCEPTION), ...Object.keys(NOT_CREATE)];
  expect(entries.filter((entry, index) => entries.indexOf(entry) !== index)).toEqual([]);
  expect(entries.filter(entry => !actions.has(entry)), "Stale inventory entries").toEqual([]);
  expect([...actions.keys()].filter(identity => !NON_CREATE_VERBS.test(identity.split("#")[1]) && !entries.includes(identity)), "Unclassified exports").toEqual([]);
  for (const reason of [...Object.values(EXCEPTION), ...Object.values(NOT_CREATE)]) expect(reason.trim()).not.toBe("");
});

it.each(KEYED)("wires %s through withCreate with its own intent", identity => {
  const fn = actions.get(identity);
  expect(fn, "Action must exist").toBeDefined();
  expect(wiringErrors(identity, fn!)).toEqual([]);
});

function parsePointErrors(source: ts.SourceFile): string[] {
  const nodes = descendants(source);
  const initializers = new Map(nodes.filter(ts.isVariableDeclaration).flatMap(node =>
    ts.isIdentifier(node.name) && node.initializer ? [[node.name.text, node.initializer] as const] : []));
  const runners = new Set(["runOperationInProcess"]);
  for (const node of nodes) {
    if (ts.isImportSpecifier(node) && node.propertyName?.text === "runOperationInProcess") runners.add(node.name.text);
  }
  function carriesIntent(node: ts.Expression | undefined, seen = new Set<string>()): boolean {
    if (!node) return false;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return carriesIntent(node.expression, seen);
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      return carriesIntent(initializers.get(node.text), seen);
    }
    return hasIntentProperty(node) || (ts.isObjectLiteralExpression(node) && node.properties.some(property =>
      ts.isSpreadAssignment(property) && carriesIntent(property.expression, new Set(seen))));
  }
  const errors: string[] = [];
  for (const node of nodes) {
    if (ts.isIdentifier(node) && node.text === "createIntentOptionsSchema") errors.push("Intent parser outside withCreate");
    if (ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && runners.has(node.expression.text)) ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "runOperationInProcess")) &&
      carriesIntent(node.arguments[3])) errors.push("Runner intent outside withCreate");
  }
  return errors;
}

it("keeps the intent parser and keyed runner options in with-create only", () => {
  expect(fnFiles.filter(source => source.fileName !== WRAPPER_FILE).flatMap(source =>
    parsePointErrors(source).map(error => `${moduleName(source.fileName)}: ${error}`))).toEqual([]);
});

it("detects separate parse points and intent options passed through local aliases", () => {
  const source = ts.createSourceFile("fixture.ts", `
    import { createIntentOptionsSchema as parseIntent } from "@/schemas/create-intent";
    import { runOperationInProcess as run } from "@/lib/operations/runner";
    const options = { intentKey }; const forwarded = { ...options };
    run(op, ctx, data, forwarded);
  `, ts.ScriptTarget.Latest, true);
  expect(parsePointErrors(source)).toEqual(["Intent parser outside withCreate", "Runner intent outside withCreate"]);
});

it("requires retry keys at every imported KEYED client call site", () => {
  const clients = [...sourceFiles(join(ROOT, "src/hooks")), ...sourceFiles(join(ROOT, "src/components"))];
  expect(clients.flatMap(clientErrors)).toEqual([]);
});

it("recognizes directive prologues, quote styles, and exported function forms", () => {
  const source = ts.createSourceFile("fixture.ts", `/* comment */ 'use strict'; 'use server';
    export async function createOne() {}
    export const createTwo = async () => {};
    const local = async function () {}; export { local as createThree };`, ts.ScriptTarget.Latest, true);
  expect(isServerModule(source)).toBe(true);
  expect([...exportedActions(source).keys()]).toEqual(["createOne", "createTwo", "createThree"]);
  expect(isServerModule(ts.createSourceFile("fixture.ts", `const x = 1; "use server";`, ts.ScriptTarget.Latest, true))).toBe(false);
});

it("rejects missing, misplaced, and unused create wiring", () => {
  for (const body of [
    "return withCreate((_ctx, create) => create(op, data), undefined);",
    "return withCreate(options, (_ctx, create) => create(op, data));",
    "return withCreate((_ctx, create) => save(data), options);",
    "return withCreate((_ctx, create) => save(create.key), options);",
  ]) {
    const source = ts.createSourceFile("fixture.ts", `export async function createFn(data: unknown, options?: CreateIntentOptions) { ${body} }`, ts.ScriptTarget.Latest, true);
    expect(wiringErrors("fixture#createFn", exportedActions(source).get("createFn")!)).not.toEqual([]);
  }
});

it("checks each imported action call, including aliases and namespace imports", () => {
  const source = ts.createSourceFile(join(ROOT, "src/hooks/fixture.ts"), `
    import { createSupplierWithLocationsFn as save, createSupplierLocationFn } from "@/fn/suppliers";
    import * as suppliers from "../fn/suppliers";
    save(data, { intentKey });
    createSupplierLocationFn(data);
    suppliers.createSupplierLocationFn(data, {});
    save(data, options);
  `, ts.ScriptTarget.Latest, true);
  expect(clientErrors(source)).toHaveLength(3);
});


it.each([
  "export default async function () {}",
  "export default async function named() {}",
  "export default async () => {}",
  "const fn = async () => {}; export default fn",
])("inventories default actions: %s", body => {
  const source = ts.createSourceFile(join(FN_ROOT, "fixture.ts"), `"use server"; ${body}`, ts.ScriptTarget.Latest, true);
  const identities = [...exportedActions(source).keys()].map(name => `${moduleName(source.fileName)}#${name}`);
  expect(identities).toEqual(["fixture#default"]);
  expect(identities.filter(identity => !NON_CREATE_VERBS.test(identity.split("#")[1]) && !KEYED.includes(identity)))
    .toEqual(["fixture#default"]);
});

it.each([
  "useMutation({ mutationFn: createOrderFn })",
  "const keep = createOrderFn; keep(data)",
  'orders["createOrderFn"](data)',
  "orders.createOrderFn",
  'orders["createOrderFn"]',
  "createOrderFn(data)",
  "createOrderFn(data, options)",
  "save(data)",
])("rejects unkeyed client references: %s", body => {
  expect(clientErrors(clientFixture(body))).toHaveLength(1);
});

it.each([
  "createOrderFn(data, { intentKey })",
  "save(data, { intentKey: key })",
  "orders.createOrderFn(data, { intentKey })",
  'orders["createOrderFn"](data, { intentKey })',
  "type Result = Awaited<ReturnType<typeof createOrderFn>>",
  "type Result = typeof orders.createOrderFn",
  "",
])("accepts keyed calls and type-only references: %s", body => {
  expect(clientErrors(clientFixture(body))).toEqual([]);
});

function clientFixture(body: string): ts.SourceFile {
  return ts.createSourceFile(join(ROOT, "src/hooks/fixture.ts"), `
    import { createOrderFn, createOrderFn as save } from "@/fn/orders";
    import * as orders from "@/fn/orders";
    ${body};
  `, ts.ScriptTarget.Latest, true);
}

it.each([
  "(_ctx, create) => { const { key } = create; return create(op, data); }",
  "(_ctx, create) => { const { key: retryKey } = create; return create(op, data); }",
  "(_ctx, { key }) => save(key)",
  "(_ctx, create) => { function read({ key } = create) { return key; } return create(op, data); }",
])("rejects create parameter destructuring: %s", callback => {
  const source = ts.createSourceFile("fixture.ts", `export async function createFn(data: unknown, options?: CreateIntentOptions) {
    return withCreate(${callback}, options);
  }`, ts.ScriptTarget.Latest, true);
  expect(wiringErrors("fixture#createFn", exportedActions(source).get("createFn")!))
    .toContainEqual(expect.stringMatching(/Only API keys/));
});

it.each(["issueUrl", "cancelInvitation", "setupFacility"])("keeps %s in the candidate inventory", name => {
  expect(NON_CREATE_VERBS.test(name)).toBe(false);
});
