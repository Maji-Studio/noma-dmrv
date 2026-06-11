export {
  deleteFacilityCertifierMapping,
  loadFacilityCertifierMapping,
  loadFacilityCertifierSummary,
  loadIsometricProjectTemplates,
  saveFacilityCertifierMapping,
  saveFacilityEmissionConfig,
  type FacilityCertifierSummary,
} from "./facility-mapping";
// Read-only browse of the registry feedstock-type catalogue (browse-only,
// no local record) for the feedstock-type form's Isometric tab.
export { loadIsometricFeedstockTypes } from "./feedstock-types";
// Read-only integration status for Settings → Health (admin-gated, no secrets).
export {
  loadCertificationHealth,
  type AllowlistStatus,
  type CertificationHealth,
} from "./health";
export {
  loadCertifyContextForCreditBatch,
  loadRemovalCertifyContext,
  loadRemovalsForFacility,
  loadSelectableBatchesForFacility,
  type SelectableBatch,
  type SelectableBatchesData,
} from "./certify-context";
// Per-batch data-completeness verdict for the credit-batch detail page +
// New-Removal wizard selection gate (classifier shared via batch-health.ts).
export { loadBatchHealth } from "./batch-health";
// Server-owned per-removal readiness for the Overview work queue (reuses the
// submit pipeline's context; classifier shared with table hint + pre-flight).
export {
  loadCertificationOverview,
  type CertificationOverviewData,
  type RemovalPreflightSummary,
} from "./overview";
export { submitRemovalAction } from "./removal-grouping";
// Deferred-create — the New-Removal wizard's "Confirm" step. Server re-derives
// each selected batch's health before atomically creating the removal.
export { createRemovalWithBatchesAction } from "./create-removal-with-batches";
// GHG Statement flow — wired live by Phase 4.5. A GHG Statement is an
// independent, period-anchored artifact that rolls up multiple Removals
// (ADR 0003).
export {
  createGhgStatementDraft,
  loadGhgStatementsForFacility,
  loadGhgStatementState,
  loadOpenRemovalsForFacility,
  refreshGhgStatementStatus,
  submitGhgStatementToVerifier,
} from "./ghg-statements";
// Phase 3.5 — mirror noma documents to Isometric Sources + attach
// source_ids to Datapoint payloads. Server-side proxy, no client blob
// handling.
export {
  loadCandidateDocumentsForRemoval,
  mirrorDocumentToSource,
  unlinkDocumentSource,
  setDocumentSourceVisibility,
  type CandidateDocument,
  type CandidateDocumentsForRemoval,
  type CandidateLineageEntity,
  type MirrorResult,
} from "./sources";
// Phase 5 Slice A — telemetry pipeline (ADR 0006). Single short-lived
// server action runs the 3 sequential POSTs (FileUpload -> PUT bytes ->
// DataUploadSubmission) and journals per-step state in payload_snapshot
// for resume.
export {
  submitTelemetryAction,
  loadTelemetrySubmissionState,
  type SubmitTelemetryArgs,
  type SubmitTelemetryResult,
} from "./submit-telemetry";
// LCA-journal CRUD for per-period emission rows. ADR 0005 / Posture B —
// no outbound POST; the operator publishes Project Components in the
// Isometric UI and the drift panel reconciles.
export {
  createProjectEmission,
  editProjectEmission,
  loadProjectEmissionById,
  loadProjectEmissionsForFacility,
  loadProjectEmissionDrift,
  removeProjectEmission,
  type ProjectEmissionDriftRow,
  type ProjectEmissionDriftState,
  type MatchStatus,
  type OrphanComponent,
} from "./project-emissions";
