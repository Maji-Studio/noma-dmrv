import type { StatusHistoryEntityType } from "@/lib/certification/status-history";

export const certificationKeys = {
  removalCarriedEntries: (removalId: string) => ["certification", "removal-carried-entries", removalId] as const,
  removalRecords: (removalId: string) => ["certification", "removal-records", removalId] as const,
  /** Whether Isometric still has the latest sent version of a Removal (admin sheet check). */
  removalRegistryPresence: (facilityId: string, removalId: string) => ["certification", "removal-registry-presence", facilityId, removalId] as const,
  removalSheetFacts: (removalId: string) => ["certification", "removal-sheet-facts", removalId] as const,
  removalEmptyLines: (removalId: string) => ["certification", "removal-empty-lines", removalId] as const,
  removalTemplateSetup: (facilityId: string) => ["certification", "removal-template-setup", facilityId] as const,
  all: ["certification"] as const,
  /** Whether a submitted Removal or GHG statement freezes the record's files. */
  recordLocks: () => [...certificationKeys.all, "record-lock"] as const,
  /** A scoped read appends its scope, so invalidating the unscoped key (a prefix) reaches both. */
  recordLock: (entityType: string, entityId?: string, scope?: "transport") =>
    (scope
      ? [...certificationKeys.all, "record-lock", entityType, entityId, scope]
      : [...certificationKeys.all, "record-lock", entityType, entityId]) as readonly unknown[],
  facilityMapping: (facilityId: string) =>
    [...certificationKeys.all, "facility-mapping", facilityId] as const,
  facilitySummary: (facilityId: string) =>
    [...certificationKeys.all, "facility-summary", facilityId] as const,
  projectTemplates: (externalProjectId: string) =>
    [...certificationKeys.all, "project-templates", externalProjectId] as const,
  feedstockTypes: () =>
    [...certificationKeys.all, "feedstock-types"] as const,
  certifyContextForCreditBatch: (creditBatchId: string) =>
    [
      ...certificationKeys.all,
      "certify-context",
      "credit-batch",
      creditBatchId,
    ] as const,
  batchTodos: (facilityId: string, creditBatchId: string) =>
    [...certificationKeys.all, "batch-todos", facilityId, creditBatchId] as const,
  batchDurabilitySummary: (creditBatchId: string) =>
    [
      ...certificationKeys.all,
      "batch-durability-summary",
      creditBatchId,
    ] as const,
  batchHealthSummaries: (facilityId: string, batchIds: string[]) =>
    [
      ...certificationKeys.all,
      "batch-health-summaries",
      facilityId,
      batchIds,
    ] as const,
  certifyContextForRemoval: (facilityId: string, removalId: string) =>
    [
      ...certificationKeys.all,
      "certify-context",
      "removal",
      facilityId,
      removalId,
    ] as const,
  removalPreflight: (facilityId: string, removalId: string) =>
    [
      ...certificationKeys.all,
      "removal-preflight",
      facilityId,
      removalId,
    ] as const,
  removalCompilation: (facilityId: string, removalId: string) =>
    [
      ...certificationKeys.all,
      "removal-compilation",
      facilityId,
      removalId,
    ] as const,
  removalTemplateDiagnostic: (facilityId: string) =>
    [
      ...certificationKeys.all,
      "removal-template-diagnostic",
      facilityId,
    ] as const,
  removalsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "removals", facilityId] as const,
  removalBreakdown: (removalId: string) =>
    [...certificationKeys.all, "removal-breakdown", removalId] as const,
  removalProductionBatches: (removalId: string) =>
    [...certificationKeys.all, "removal-production-batches", removalId] as const,
  selectableBatches: (facilityId: string) =>
    [...certificationKeys.all, "selectable-batches", facilityId] as const,
  ghgStatementsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "ghg-statements", facilityId] as const,
  ghgStatementState: (ghgStatementId: string) =>
    [...certificationKeys.all, "ghg-statement", ghgStatementId] as const,
  ghgStatementBreakdown: (ghgStatementId: string) =>
    [
      ...certificationKeys.all,
      "ghg-statement-breakdown",
      ghgStatementId,
    ] as const,
  ghgStatementReports: (ghgStatementId: string) =>
    [
      ...certificationKeys.all,
      "ghg-statement-reports",
      ghgStatementId,
    ] as const,
  openRemovalsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "open-removals", facilityId] as const,
  registryGhgStatementsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "registry-ghg-statements", facilityId] as const,
  overview: (facilityId: string) =>
    [...certificationKeys.all, "overview", facilityId] as const,
  /** Status history behind a Removal or GHG Statement badge. */
  statusHistory: (entityType: StatusHistoryEntityType, entityId: string) =>
    [...certificationKeys.all, "status-history", entityType, entityId] as const,
  health: () => [...certificationKeys.all, "health"] as const,
  registrySourceVisibility: () =>
    [...certificationKeys.all, "registry-source-visibility"] as const,
};
