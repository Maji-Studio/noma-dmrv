import type { BatchEmissionLine } from "@/lib/certification/emission-lines";
import type { RemovalAdvisory } from "@/lib/certification/removal-blockers";
import type { SubmissionLineageBlocker } from "@/lib/certification/submission-readiness";
import type { UnbindableTemplateInput } from "@/lib/isometric/template-binding-coverage";
import type { CertificationSubmissionRow, CertifierProjectRow } from "@/data-access/certification";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { RemovalRunSummary } from "@/lib/certification/mass-accounting";
import type { ProductionReadinessGap } from "@/lib/certification/production-readiness";
import type { FeedstockTypeMappingGap } from "@/lib/certification/feedstock-type-mapping";
import type { IsometricComponentBlueprint, IsometricProject, IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { LineSources } from "@/lib/isometric/template-observations/line-sources";
import type { RemovalTemplateBlocker } from "@/lib/certification/removal-template-blockers";
import type { ProductionRunForCertification } from "@/lib/isometric/utils/aggregation";
import type { FacilityReferenceSoilTemperature } from "@/lib/isometric/utils/durability-aggregation";
import type { TransportLegsByCategory } from "./shared";
import type { EvidenceMirrorSummary } from "./evidence-mirror-summary";
import type { LinkedGhgStatementStatus } from "./linked-ghg-statement-status";
import type { MemberCreditBatch } from "./member-credit-batch";
import type { RemovalLedgerPreview } from "./removal-ledger-preview";
import type { TransportCategory, TransportCoverage } from "./certify-transport-coverage";

type DurabilityOption = "200_year" | "1000_year";
// UI-facing removal context — the lean payload React Query caches.
export interface RemovalCertifyContext {
  facilityId: string;
  hasOrgCredentials: boolean;
  // Null when the credit batch is not yet grouped into a removal (a 1:1
  // removal is created lazily on first submit).
  removalId: string | null;
  // Persisted §8.6.2 registry reporting window for this Removal.
  reportingWindowStartedOn: string | null;
  reportingWindowCompletedOn: string | null;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  removalTemplate: IsometricGhgEntryTemplate | null;
  lineSources: LineSources;
  templateBlockers: RemovalTemplateBlocker[];
  emissionLinesByBatchId?: Record<string, BatchEmissionLine[]>;
  emissionLines?: BatchEmissionLine[] | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  unbindableTemplateInputs: UnbindableTemplateInput[];
  memberBatches: MemberCreditBatch[];
  emissionsLedger: RemovalLedgerPreview;
  feedstockTypeMappingGaps: FeedstockTypeMappingGap[];
  transportCoverage: TransportCoverage;
  requiredTransportCategories: TransportCategory[];
  // True once member-batch lineage resolves at least one production run —
  // i.e. there is something to submit. Surfaced on the UI context so the
  // client-side readiness classifier (review pre-flight) sees the same
  // `hasSubmittableRuns` fact the server-owned Overview loader does, without
  // shipping the heavy `runs` array to the client.
  hasSubmittableRuns: boolean;
  // Specific blocker when production lineage does not resolve a run. This keeps
  // no-applications / broken-product-link cases out of the generic production
  // bucket on health and readiness surfaces.
  productionReadinessGap: ProductionReadinessGap | null;
  // Compact labels from the per-entity certifier-readiness layer; the submit
  // pipeline gates on this same list, so [] means entity-ready.
  entityReadinessGaps: string[];
  submissionLineageBlockers: SubmissionLineageBlocker[];
  durabilityConfigurationBlockers: string[];
  templateTierBlocker?: string | null;
  entityReadinessIssues?: import("@/lib/certification/batch-health").BatchEntityReadinessIssue[];
  // Fail-closed durability sampling/eligibility blockers (D3) — the EXACT list
  // the submit pipeline blocks on, so readiness predicts the gate. [] ⇒ ready.
  durabilityGateBlockers: string[];
  // Production-run end times / biochar application dates that still lie in the
  // future, phrased as blocker sentences. The SAME verdict the submit-time
  // guard `assertRemovalDatesNotFuture` reaches, computed here against the
  // server clock so the readiness classifier can stay pure and clock-free.
  // [] ⇒ every measurement date has already happened.
  futureDatedMeasurements: string[];
  // Non-blocking submission advisories — e.g. recorded startup/plant diesel the
  // active template has no component to carry (ADR 0015). Unlike
  // durabilityGateBlockers / entityReadinessGaps, these do NOT gate submission;
  // they tell the operator a recorded value will not be submitted.
  submissionWarnings: string[];
  submissionAdvisories?: RemovalAdvisory[];
  supportingDocuments: EvidenceMirrorSummary;
  // Focused run aggregation (run count, total biochar output, applied dry kg)
  // surfaced on the lean UI context so the Review step can show what's being
  // submitted without shipping the heavy `runs` array.
  runSummary: RemovalRunSummary;
  latestSubmission: CertificationSubmissionRow | null;
  // Any ledger version reached submitted/accepted/superseded. The latest row
  // alone cannot say (a superseding draft sits above a submitted prior); the
  // delete gate needs it because the server refuses on any finalized row.
  hasFinalizedSubmission: boolean;
  // A submit attempt opened the registry boundary (Source mirroring) before
  // any ledger row existed. Deletion treats it as registry exposure.
  registryBoundaryOpened: boolean;
  // The GHG Statement this removal rolls into + its verifier status, or null
  // when the removal isn't linked to one. See `LinkedGhgStatementStatus`.
  linkedGhgStatement: LinkedGhgStatementStatus | null;
  isProduction: boolean;
}

// Extends the UI context with the raw chain data the submit pipeline needs.
// Kept server-internal so the cached UI payload stays lean.
export interface RemovalSubmissionContext extends Omit<RemovalCertifyContext, "emissionsLedger"> {
  lineages: ChainOfCustodyData[];
  runs: ProductionRunForCertification[];
  // The removal's member credit batches with their pooled lab Samples (by
  // `samples.creditBatchId`) — the CREDIT-BATCH-grained durability data plane
  // (ADR 0016). Drives the durability gates here and the per-batch
  // measurement-sample submission step (Phase 3). Each batch's `runs` are scoped
  // to the removal's applied run set so product mass is attribution-correct.
  batchesWithSamples: CreditBatchWithSamples[];
  // Per-run applied-biochar fraction (linear mass allocation). Passed to
  // `aggregateProductionRuns`, where it scopes ONLY stored/delivery-bucket
  // quantities + chemistry weights — production-bucket inputs sum full run
  // totals (§8.6.2 front-loading, issue #349, ADR 0020).
  attributionByRunId: Map<string, number>;
  // §8.6.2 per-member-batch production-bucket claim state (issue #349) —
  // drives the submit-path foreign-claim assertion and the claim write. The
  // sorted lineage arrays are the fingerprint the post-claim fresh re-assert
  // compares to a fresh scope read, failing closed when membership or run
  // lineage drifted between context load and the draft claim (ADR 0020).
  memberBatchClaims: {
    creditBatchId: string;
    code: string;
    durabilityOption: DurabilityOption;
    claimedByRemovalId: string | null;
    claimingRemovalCode?: string | null;
    productionRunIds: string[];
    applicationIds: string[];
    applicationSlices?: {
      applicationId: string;
      allocatedWetMassKg: number;
      allocatedDryMassKg: number;
    }[];
  }[];
  // Transport legs pooled across every member batch's lineage, deduped by
  // entity id. Fed to `enrichWithTransportLegs` by the submit pipeline.
  transportLegs: TransportLegsByCategory;
  // The facility's resolved reference soil temperature (declared value, 7 °C
  // floored, one decimal) submitted as the `biochar_soil` measurement for a
  // 200-year removal (Phase 2). Null when the facility has not configured one —
  // when there are credit batches to submit, that null is fail-closed via a
  // durability gate blocker, so the Phase-3 step can assume non-null here.
  facilityReferenceSoilTemperature: FacilityReferenceSoilTemperature | null;
}


