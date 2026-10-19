import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Coverage = { status: "direct" } | { status: "runner"; operations: string[] } | { status: "exempt"; reason: string };

// Explicit inventory includes wrappers, cascades and derived writers. Discovery
// below scans the whole data-access tree so new modules cannot bypass it.
const ACTIVITY_COVERAGE = {
  "emission-line-comments.ts": {
    setEmissionLineComment: { status: "direct" },
    deleteEmissionLineComment: { status: "direct" },
  },
  "transport-distance-refresh.ts": {
    refreshFeedstockDistanceInTransaction: { status: "runner", operations: ["refresh_feedstock_distance"] },
    refreshDeliveryDistanceInTransaction: { status: "runner", operations: ["refresh_delivery_distance"] },
  },
  "emission-entries.ts": {
    createEmissionEntry: { status: "direct" },
    updateEmissionEntry: { status: "direct" },
    confirmEmissionEntry: { status: "direct" },
    deleteEmissionEntry: { status: "direct" },
    restoreEmissionEntry: { status: "direct" },
    replaceEmissionEntry: { status: "direct" },
    tombstoneEmissionZeros: { status: "direct" },
  },
  "emission-entry-lock.ts": {
    bumpEmissionEntryEvidence: { status: "exempt", reason: "The document writer records the activity." },
  },
  "credit-batch-application-slices.ts": {
    reconcileUnassignedCreditBatchApplicationSlices: { status: "exempt", reason: "Derived unassigned slices; the initiating application or batch membership writer owns activity (ADR 0019)." },
  },
  "credit-batch-delete-slices.ts": {
    deleteCreditBatchApplicationSlices: { status: "exempt", reason: "Internal slice cleanup; deleteCreditBatch records the batch lifecycle event." },
  },
  "facilities.ts": {
    createFacility: { status: "exempt", reason: "Facility reference-data lifecycle has no entity activity type." },
    updateFacility: { status: "exempt", reason: "Facility reference-data edits have no entity activity type." },
    archiveFacility: { status: "direct" },
    restoreFacility: { status: "direct" },
  },
  "vehicles.ts": {
    updateVehicle: { status: "direct" },
    deleteVehicle: { status: "exempt", reason: "Vehicle reference-data deletion leaves transport leg snapshots unchanged." },
  },
  "production-run-reading-imports.ts": {
    insertProductionRunReadingsSkippingDuplicates: { status: "exempt", reason: "Telemetry ingestion is measurement data, separate from operator entity activity." },
    recordReadingsImportOutcome: { status: "exempt", reason: "Import outcome metadata is internal bookkeeping; document lifecycle is recorded separately." },
  },
  "production-claim-reservations.ts": {
    reserveProductionEmissionsClaims: { status: "direct" },
    rejectSubmissionAndReleaseProductionClaims: { status: "direct" },
  },
  "certifier-removals.ts": {
    createRemovalWithCreditBatches: { status: "direct" },
    discardLocalRemovalDraft: { status: "direct" },
    markRemovalSubmissionExternalMutationPossible: { status: "exempt", reason: "External mutation markers are internal retry bookkeeping; status transitions record lifecycle activity." },
    updateRemovalDates: { status: "exempt", reason: "Removal date edit activity is deferred; see docs/open-questions.md." },
    updateRemovalSourceBindingVerification: { status: "exempt", reason: "Registry source verification is internal submission bookkeeping." },
  },
  "certifier-removal-deletion.ts": {
    finalizeRemovalDeletion: { status: "direct" },
  },
  "formulation-writes.ts": {
    createFormulationInTransaction: { status: "runner", operations: ["create_formulation"] },
    updateFormulationInTransaction: { status: "runner", operations: ["update_formulation"] },
    deleteFormulationInTransaction: { status: "runner", operations: ["delete_formulation"] },
    archiveFormulationInTransaction: { status: "runner", operations: ["archive_formulation"] },
    restoreFormulationInTransaction: { status: "runner", operations: ["restore_formulation"] },
  },
  "application-writes.ts": {
    createApplicationInTransaction: { status: "runner", operations: ["record_application"] },
    updateApplicationInTransaction: { status: "runner", operations: ["update_application"] },
    deleteApplicationInTransaction: { status: "runner", operations: ["delete_application"] },
  },
  "credit-batches.ts": {
    createCreditBatch: { status: "direct" },
    updateCreditBatch: { status: "direct" },
    deleteCreditBatch: { status: "direct" },
  },
  "credit-batch-entry-dates.ts": {
    syncCreditBatchEntryDates: { status: "direct" },
  },
  "credit-batch-removal-template.ts": {
    switchCreditBatchRemovalTemplate: { status: "direct" },
  },
  "certifier-project-credit-batches.ts": {
    adoptCreditBatchesForIsometric: { status: "direct" },
  },
  "credit-batch-membership.ts": {
    attachProductionRunToMatchingCreditBatch: { status: "direct" },
  },
  "documents.ts": {
    insertDocument: { status: "direct" },
    deleteDocumentRow: { status: "direct" },
    retireDocumentsForEntities: { status: "direct" },
    retireTombstonedEmissionEntryDocuments: { status: "direct" },
  },
  "document-writes.ts": {
    requestDocumentUploadInTransaction: { status: "runner", operations: ["request_document_upload", "request_document_upload_app"] },
    confirmDocumentUploadInTransaction: { status: "runner", operations: ["confirm_document_upload", "confirm_document_upload_app"] },
  },
  "document-mutations.ts": {
    deleteDocumentInTransaction: { status: "runner", operations: ["delete_document_app"] },
    setDocumentVisibilityInTransaction: { status: "runner", operations: ["set_document_visibility_app"] },
    updateApplicationEvidenceMetadataInTransaction: { status: "runner", operations: ["reclassify_application_evidence_app"] },
  },
  "document-upload-preparation.ts": {
    recordDocumentPromotionCandidate: { status: "exempt", reason: "Internal storage cleanup metadata; confirm operations describe the document transition." },
  },
  "document-upload-renewal.ts": {
    renewDocumentUploadInTransaction: { status: "exempt", reason: "Lease bookkeeping only; renewal does not change document content, status or version." },
  },
  "document-upload-sweep.ts": {
    expireDocumentUploadsInTransaction: { status: "exempt", reason: "Abandoned pending-upload bookkeeping, outside operator document edits." },
    retireFailedDocumentUploadsInTransaction: { status: "direct" },
    sweepDocumentUploads: { status: "direct" },
  },
  "document-storage-deletions.ts": {
    enqueueDocumentKeys: { status: "exempt", reason: "Storage cleanup queue only; the initiating document writer records activity." },
    enqueuePromotionCandidates: { status: "exempt", reason: "Storage cleanup queue only; no document entity is changed." },
  },
  "feedstocks.ts": {
    createFeedstockInTransaction: { status: "runner", operations: ["log_feedstock_delivery"] },
    updateFeedstockInTransaction: { status: "runner", operations: ["update_feedstock"] },
    deleteFeedstockInTransaction: { status: "runner", operations: ["delete_feedstock"] },
  },
  "orders.ts": {
    createOrderInTransaction: { status: "runner", operations: ["record_order"] },
    updateOrderInTransaction: { status: "runner", operations: ["update_order"] },
    deleteOrderInTransaction: { status: "runner", operations: ["delete_order"] },
  },
  "certification-status-activity.ts": {
    withCertificationStatusActivity: { status: "direct" },
  },
  "production-incidents.ts": {
    createProductionIncident: { status: "exempt", reason: "Incident records have no entity activity type; their document retirements are covered." },
    updateProductionIncident: { status: "exempt", reason: "Incident records have no entity activity type." },
    deleteProductionIncident: { status: "exempt", reason: "Incident records have no entity activity type; their document retirements are covered." },
  },
  "production-samples.ts": {
    createProductionSample: { status: "exempt", reason: "In-process measurements have no entity activity type; their document retirements are covered." },
    updateProductionSample: { status: "exempt", reason: "In-process measurements have no entity activity type." },
    deleteProductionSample: { status: "exempt", reason: "In-process measurements have no entity activity type; their document retirements are covered." },
  },
  "samples/delete.ts": {
    deleteSampleInTransaction: { status: "runner", operations: ["delete_lab_sample"] },
  },
  "production-runs/delete.ts": {
    deleteProductionRun: { status: "exempt", reason: "Legacy production-run deletion activity is deferred; document retirements are covered. See docs/open-questions.md." },
    deleteProductionRunInTransaction: { status: "runner", operations: ["delete_production_run"] },
  },
  "certification.ts": {
    upsertCertifierProject: { status: "exempt", reason: "Registry project mappings are reference configuration without an entity activity type." },
    markSubmissionSubmitted: { status: "direct" },
    retireStaleSubmissionDraft: { status: "direct" },
    markSubmissionRejected: { status: "direct" },
    setSubmissionTerminalStatus: { status: "direct" },
    attachReportDocument: { status: "direct" },
    updateFacilityEmissionConfig: { status: "exempt", reason: "Facility energy configuration has no entity activity type." },
    deleteCertifierProject: { status: "exempt", reason: "Registry project mapping deletion changes reference configuration without an entity activity type." },
    updateSubmissionMetadata: { status: "direct" },
  },
  "ghg-statement-reports.ts": {
    insertPreparedGhgStatementReport: { status: "direct" },
  },
  "transport-legs.ts": {
    createTransportLeg: { status: "direct" },
    updateTransportLeg: { status: "direct" },
    deleteTransportLeg: { status: "direct" },
    deleteTransportLegsForEntity: { status: "direct" },
    syncFeedstockTransportLeg: { status: "direct" },
    syncBiocharProductTransportLegs: { status: "direct" },
  },
} satisfies Record<string, Record<string, Coverage>>;

const COVERED_TABLES = new Set([
  "creditBatches", "creditBatchProductionRuns", "creditBatchApplications",
  "applications", "documents", "transportLegs", "emissionEntries", "emissionEntryValues", "emissionLineComments",
  "formulations", "formulationIngredients",
]);
const WRITE_PREFIX = /^(create|update|delete|attach|detach|archive|insert|upsert|sync|replace|retire|remove|set|mark)/;
type Inventory = Record<string, Record<string, Coverage>>;

function inspectModule(source: string) {
  const file = ts.createSourceFile("writers.ts", source, ts.ScriptTarget.Latest, true);
  const aliases = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.startsWith("@/db/schema")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
      aliases.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  function writesCoveredTable(node: ts.Node): boolean {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && /^(insert|update|delete)$/.test(node.expression.name.text)) {
      const table = node.arguments[0];
      const name = table && (ts.isIdentifier(table) ? aliases.get(table.text) ?? table.text
        : ts.isPropertyAccessExpression(table) ? table.name.text : undefined);
      if (name && COVERED_TABLES.has(name)) return true;
    }
    return ts.forEachChild(node, writesCoveredTable) ?? false;
  }
  const exports = new Map<string, ts.Node>();
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exports.set(element.name.text, element);
    }
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) exports.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) exports.set(declaration.name.text, declaration);
    }
  }
  return {
    names: [...exports.keys()],
    writers: [...exports].filter(([name, node]) => WRITE_PREFIX.test(name) || writesCoveredTable(node)).map(([name]) => name),
    writesCoveredTable: writesCoveredTable(file),
  };
}

function describedOperationIds(modules: Record<string, string>): Set<string> {
  const ids = new Set<string>();
  for (const source of Object.values(modules)) {
    const file = ts.createSourceFile("operations.ts", source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isObjectLiteralExpression(node)) {
        const id = node.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(file) === "id");
        const described = node.properties.some(property => property.name?.getText(file) === "describe");
        if (described && id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer)) ids.add(id.initializer.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return ids;
}

function coverageGaps(modules: Record<string, string>, inventory: Inventory): string[] {
  return Object.entries(modules).flatMap(([module, source]) => {
    const inspected = inspectModule(source);
    if (!inspected.writesCoveredTable && !Object.hasOwn(inventory, module)) return [];
    if (!Object.hasOwn(inventory, module)) return [`Unlisted write module: ${module}`];
    return inspected.writers.filter(name => !Object.hasOwn(inventory[module], name))
      .map(name => `Unclassified writer: ${module}:${name}`);
  });
}

function readModules(directory: URL, prefix = ""): Record<string, string> {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return Object.entries(readModules(new URL(`${entry.name}/`, directory), `${name}/`));
    if (!entry.name.endsWith(".ts") || /\.(test|spec)\.ts$/.test(entry.name)) return [];
    return [[name, readFileSync(new URL(entry.name, directory), "utf8")]];
  }));
}

describe("activity coverage inventory", () => {
  it("accounts for every module writing covered tables and every exported writer", () => {
    const modules = readModules(new URL("./", import.meta.url));
    const operations = describedOperationIds(readModules(new URL("../lib/operations/", import.meta.url)));
    expect(coverageGaps(modules, ACTIVITY_COVERAGE)).toEqual([]);
    for (const [module, inventory] of Object.entries(ACTIVITY_COVERAGE)) {
      const { names } = inspectModule(modules[module]);
      for (const [name, coverage] of Object.entries(inventory)) {
        expect(names, `Stale inventory entry: ${module}:${name}`).toContain(name);
        if (coverage.status === "exempt") expect(coverage.reason.trim()).not.toBe("");
        if (coverage.status === "runner") {
          expect(coverage.operations.length).toBeGreaterThan(0);
          for (const id of coverage.operations) expect(operations, `Missing described operation: ${module}:${name}:${id}`).toContain(id);
        }
      }
    }
  });

  it("discovers declarations, variable writers and re-exports", () => {
    expect(inspectModule(`export async function createThing() {}\nexport const deleteThing = () => {};\nexport { updateThing } from './other';`).names)
      .toEqual(["createThing", "deleteThing", "updateThing"]);
  });

  it.each([...COVERED_TABLES])("rejects an unlisted writer to %s in a new nested module", table => {
    expect(coverageGaps({ "new/writer.ts": `export async function persistThing() { await tx.insert(${table}).values({}); }` }, {}))
      .toEqual(["Unlisted write module: new/writer.ts"]);
  });

  it("requires classification for direct writers without a recognized prefix and schema aliases", () => {
    const modules = { "writer.ts": `import { documents as evidence } from '@/db/schema';
      export async function persistThing() { await tx.update(evidence).set({}); }` };
    expect(coverageGaps(modules, { "writer.ts": {} })).toEqual(["Unclassified writer: writer.ts:persistThing"]);
  });

  it.each(["insert", "upsert", "sync", "replace", "retire", "remove", "set", "mark"])("requires classification for the %s prefix", prefix => {
    expect(coverageGaps({ "writer.ts": `export const ${prefix}Thing = () => {};` }, { "writer.ts": {} }))
      .toEqual([`Unclassified writer: writer.ts:${prefix}Thing`]);
  });
});
