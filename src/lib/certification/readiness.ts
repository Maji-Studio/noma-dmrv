import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
/**
 * Removal readiness classifier — the single pure decision behind every
 * "can this removal be submitted, and if not why?" surface: the Overview work
 * queue (Stage 3), the Removals table readiness hint, and the Review pre-flight
 * step (Stage 4). Centralising it means those three never drift.
 *
 * Strictly client-safe: depends only on `./status` (itself pure) and plain
 * primitives. The server loader (`fn/certification/overview.ts`) gathers the
 * facts from the heavy submission context and feeds them in; this module makes
 * the verdict. Mirrors the inline logic that lived in `certify-panel.tsx`
 * (`templateResolved` + `analyzeCoverage` + `submitReady`), now extracted and
 * unit-tested — Stage 4 migrates the panel/pre-flight onto it.
 */
import type { SubmissionLineageBlocker } from "./submission-readiness";
import { formatUnbindableTemplateInputsText, type UnbindableTemplateInput } from "@/lib/isometric/template-binding-coverage";

import {
  BLOCKING_SUBMISSION_STATUSES,
  deriveRemovalStatus,
  type LocalSubmissionStatus,
} from "./status";
import {
  defaultProductionReadinessGap,
  type ProductionReadinessGap,
} from "./production-readiness";
import { CERT_REQUIREMENT_META } from "./requirement-labels";
import type { RemovalTemplateBlocker, RemovalTemplateBlockerCode } from "./removal-template-blockers";
import { pluralize } from "@/lib/copy-utils";
import {
  describeFeedstockTypeMappingGap,
  type FeedstockTypeMappingGap,
} from "./feedstock-type-mapping";

export type RemovalReadinessState =
  | "submitted" // done from noma's side — nothing to action
  | "inProgress" // a submission lock is live
  | "blocked" // one or more preconditions unmet (see `reasons`)
  | "ready"; // all preconditions met — one-click submittable

export type TransportCategory = "feedstock" | "biochar" | "sample";

export interface TransportCoverageFact {
  category: TransportCategory;
  /** Transport legs found for this category across the removal's members. */
  count: number;
  missingEntityIds?: readonly string[];
  /** Repair targets belonging to this existing transport check. */
  lineageIssues?: SubmissionLineageBlocker[];
  /** A per-leg uniformity/completeness warning from aggregation, if any. */
  aggregationWarning: string | null;
}

export interface RemovalReadinessFacts {
  /** Latest ledger status, or null when no submission row exists yet. */
  local: LocalSubmissionStatus | null;
  /** A draft row holding a live submission lock. */
  lockInFlight: boolean;
  /** The facility is linked to an Isometric project. */
  hasMapping: boolean;
  /** The organization has encrypted Isometric credentials configured. */
  hasOrgCredentials: boolean;
  /** The member batches' pinned Removal template resolved on Isometric. */
  hasRemovalTemplate: boolean;
  templateBlockers?: RemovalTemplateBlocker[];
  /** Template blueprint keys with no matching component blueprint. */
  unresolvedBlueprintKeys: string[];
  unbindableTemplateInputs: UnbindableTemplateInput[];
  /** Declared pyrolysis feedstock types missing their Isometric registry id. */
  feedstockTypeMappingGaps: FeedstockTypeMappingGap[];
  /** Production runs resolved from member-batch lineage — false ⇒ nothing to submit. */
  hasSubmittableRuns: boolean;
  /** Specific reason production lineage is not submittable, when known. */
  productionReadinessGap?: ProductionReadinessGap | null;
  /** Coverage facts for the template's required transport categories only. */
  requiredTransport: TransportCoverageFact[];
  /** Non-blocking review of vehicle records across required transport categories. */
  transportVehicleAdvisories?: string[];
  /** Compact labels from per-entity certifier-readiness checks. */
  entityReadinessGaps?: string[];
  /** Structured submission checks with affected records and fix targets. */
  submissionLineageIssues?: SubmissionLineageBlocker[];
  /** Documents discovered by the same lineage walk as the Sources panel. */
  supportingDocumentCount?: number;
  /** Supporting documents with an existing Isometric Source mirror. */
  mirroredDocumentCount?: number;
  /**
   * Fail-closed durability sampling/eligibility blockers (decision D3) — the
   * exact list the submit pipeline hard-blocks on. Empty ⇒ sampling &
   * eligibility are submission-ready. Surfaced so readiness predicts the gate.
   */
  durabilityGateBlockers?: string[];
  /** Registry capabilities shared with the measurement-sample builder. */
  durabilityConfigurationBlockers?: string[];
  /**
   * Production-run ends, Sample times, or application dates that still lie in the
   * future, already phrased as blocker sentences. Computed SERVER-SIDE (this
   * module is deliberately clock-free and deterministic) by
   * `collectFutureDatedMeasurements`, which mirrors the submit-time guard
   * `assertRemovalDatesNotFuture`. Empty ⇒ every date has already happened.
   */
  futureDatedMeasurements?: string[];
}

export interface RemovalReadiness {
  state: RemovalReadinessState;
  /** Human-readable blocker reasons; empty unless state === "blocked". */
  reasons: string[];
  /** Non-blocking conditions operators should see before submission. */
  advisories: string[];
  /** Vehicle review warnings, separate from automatic evidence work. */
  transportVehicleAdvisories: string[];
}

const NOT_LINKED_REASON = "Facility not linked to an Isometric project";
const NO_ORG_CREDENTIALS_REASON =
  "Organization Isometric credentials are not configured";
const ORG_CREDENTIALS_LABEL = "Organization Isometric credentials present";
const TRANSPORT_COVERAGE_LABEL = "Transport coverage complete";
const ENTITY_READINESS_LABEL = "Entity certifier fields complete";
const ENTITY_READINESS_REASON_PREVIEW_LIMIT = 3;
export const ENTITY_READINESS_CHECK_DISPLAY_LIMIT = 5;
const DURABILITY_LABEL = "Sampling & durability eligibility met";
const EVIDENCE_LABEL = "Registry value sources linked";
const MEASUREMENT_DATES_LABEL = "Production and application dates";
const FUTURE_DATE_REASON_PREVIEW_LIMIT = 3;
const FUTURE_DATE_CHECK_DISPLAY_LIMIT = 3;
// Keep the blocker list readable: show the first few full blocker lines as
// reasons, then a "+N more" rollup rather than flooding the verdict.
const DURABILITY_BLOCKER_REASON_PREVIEW_LIMIT = 3;
const DURABILITY_BLOCKER_CHECK_DISPLAY_LIMIT = 3;

// Durability sampling/eligibility gaps, phrased as the classifier's blocker
// reasons. Each blocker is already a full protocol-cited sentence (see
// `durability-submission-gates.ts`), so they are pushed verbatim, capped.
function durabilityBlockerReasons(blockers: string[]): string[] {
  if (blockers.length === 0) return [];
  const shown = blockers.slice(0, DURABILITY_BLOCKER_REASON_PREVIEW_LIMIT);
  const overflow = blockers.length - shown.length;
  return overflow > 0
    ? [...shown, `+${overflow} more sampling or eligibility ${pluralize(overflow, "issue")}`]
    : shown;
}

// Future-dated run ends / application dates (mirrors the submit-time guard
// `assertRemovalDatesNotFuture`). Each entry is already a full actionable
// sentence naming the record, so they are pushed verbatim, capped.
function futureDatedMeasurementReasons(measurements: string[]): string[] {
  if (measurements.length === 0) return [];
  const shown = measurements.slice(0, FUTURE_DATE_REASON_PREVIEW_LIMIT);
  const overflow = measurements.length - shown.length;
  const dateLabel = overflow === 1 ? "date" : "dates";
  return overflow > 0
    ? [...shown, `+${overflow} more future ${dateLabel}`]
    : shown;
}

function futureDatedMeasurementSummary(measurement: string): string {
  const instructionStart = measurement.indexOf(". Change the ");
  return instructionStart === -1
    ? measurement
    : measurement.slice(0, instructionStart + 1);
}

function describeCategories(categories: TransportCategory[]): string {
  return categories.join(", ");
}

// The one canonical template-resolution blocker reason. Returns null when the
// template chain resolves cleanly. Shared by the classifier and the pre-flight
// checklist so the two never phrase the same blocker differently.
function templateBlockerReason(facts: RemovalReadinessFacts): string | null {
  if (facts.templateBlockers?.length) return facts.templateBlockers.map((blocker) => blocker.message).join(" ");
  if (!facts.hasRemovalTemplate) {
    return REMOVAL_TEMPLATE_BLOCKERS.unpinnedTemplate;
  }
  if (facts.unresolvedBlueprintKeys.length > 0) {
    const n = facts.unresolvedBlueprintKeys.length;
    return `Template references ${n} unresolved blueprint${n === 1 ? "" : "s"}`;
  }
  if (facts.unbindableTemplateInputs.length > 0) {
    return formatUnbindableTemplateInputsText(facts.unbindableTemplateInputs);
  }
  return null;
}

function templateResolvesCleanly(facts: RemovalReadinessFacts): boolean {
  return (
    facts.hasRemovalTemplate &&
    !facts.templateBlockers?.length &&
    facts.unresolvedBlueprintKeys.length === 0 &&
    facts.unbindableTemplateInputs.length === 0
  );
}

// Transport-coverage gaps, phrased exactly as the classifier's blocker reasons.
function transportGapReasons(required: TransportCoverageFact[]): string[] {
  const missing = required.filter((t) => t.count === 0 || (t.missingEntityIds?.length ?? 0) > 0).map((t) => t.category);
  const incomplete = required
    .filter((t) => t.count > 0 && t.aggregationWarning !== null)
    .map((t) => t.category);
  const reasons: string[] = [];
  if (missing.length > 0) {
    reasons.push(`Missing ${describeCategories(missing)} transport legs`);
  }
  if (incomplete.length > 0) {
    reasons.push(`Incomplete ${describeCategories(incomplete)} transport legs`);
  }
  return reasons;
}

function productionGapDetail(facts: RemovalReadinessFacts): string {
  return (
    facts.productionReadinessGap?.detail ??
    defaultProductionReadinessGap().detail
  );
}

function evidenceMirrorDetail(
  facts: RemovalReadinessFacts,
): string | null {
  const total = facts.supportingDocumentCount ?? 0;
  if (total === 0) return null;
  const mirrored = Math.min(facts.mirroredDocumentCount ?? 0, total);
  const pending = total - mirrored;
  return pending > 0
    ? `${pending}${pending === total ? "" : ` of ${total}`} ${pending === 1 ? "file is" : "files are"} sent automatically when you submit`
    : `${total} of ${total} ${total === 1 ? "file" : "files"} ready`;
}

function evidenceAdvisories(facts: RemovalReadinessFacts): string[] {
  const detail = evidenceMirrorDetail(facts);
  if (!detail) return [];
  return (facts.mirroredDocumentCount ?? 0) < (facts.supportingDocumentCount ?? 0)
    ? [detail]
    : [];
}

/**
 * Folds removal status + submission preconditions into one verdict.
 * Precedence: live lock → terminal submitted row → blocked → ready.
 */
export function deriveRemovalReadiness(
  facts: RemovalReadinessFacts,
): RemovalReadiness {
  const transportVehicleAdvisories = facts.transportVehicleAdvisories ?? [];
  const advisories = evidenceAdvisories(facts);
  const advisoryFields = { advisories, transportVehicleAdvisories };
  if (facts.lockInFlight) return { state: "inProgress", reasons: [], ...advisoryFields };

  // Status drives the high end. A latest superseded row is non-terminal: it is
  // a retired attempt for which `claimSubmissionDraft` will mint a fresh
  // version. A removal is done only at submitted (no remote lifecycle exists;
  // see status.ts).
  const status = deriveRemovalStatus({ local: facts.local, lockInFlight: false });
  if (status.isTerminal) return { state: "submitted", reasons: [], ...advisoryFields };

  // Not submitted yet (null / draft / rejected) → evaluate preconditions.
  if (!facts.hasMapping) {
    // Without a project link every downstream fact is empty; one clear reason.
    return { state: "blocked", reasons: [NOT_LINKED_REASON], ...advisoryFields };
  }

  if (!facts.hasOrgCredentials) {
    return {
      state: "blocked",
      reasons: [NO_ORG_CREDENTIALS_REASON],
      ...advisoryFields,
    };
  }

  const reasons: string[] = [...(facts.submissionLineageIssues?.map((issue) => issue.detail) ?? [])];

  const templateReason = templateBlockerReason(facts);
  if (templateReason) reasons.push(templateReason);

  // Transport requirements come from the template, so only judge coverage once
  // the template chain resolves cleanly.
  if (templateResolvesCleanly(facts)) {
    reasons.push(...transportGapReasons(facts.requiredTransport));
  }

  if (!facts.hasSubmittableRuns) {
    reasons.push(productionGapDetail(facts));
  }

  if (templateResolvesCleanly(facts)) {
    reasons.push(
      ...facts.feedstockTypeMappingGaps.map(describeFeedstockTypeMappingGap),
    );
  }

  const entityReadinessGaps = facts.entityReadinessGaps ?? [];
  if (entityReadinessGaps.length > 0) {
    const suffix =
      entityReadinessGaps.length > ENTITY_READINESS_REASON_PREVIEW_LIMIT
        ? ", ..."
        : "";
    reasons.push(
      `Incomplete entity certifier data: ${entityReadinessGaps
        .slice(0, ENTITY_READINESS_REASON_PREVIEW_LIMIT)
        .join(", ")}${suffix}`,
    );
  }

  // Measurement dates — the same guard the submit pipeline runs LAST
  // (`assertRemovalDatesNotFuture`). Blocking here means a future-dated run end
  // or application shows red in the checklist instead of only failing after the
  // operator clicks submit.
  reasons.push(
    ...futureDatedMeasurementReasons(facts.futureDatedMeasurements ?? []),
  );

  // Durability sampling/eligibility — the same fail-closed gate the submit
  // pipeline throws on (D3). Surfacing it here means a removal can't read
  // "ready" then bounce at submit on an unsampled run or out-of-spec chemistry.
  reasons.push(...(facts.durabilityConfigurationBlockers ?? []));
  reasons.push(...durabilityBlockerReasons(facts.durabilityGateBlockers ?? []));

  return reasons.length > 0
    ? { state: "blocked", reasons, ...advisoryFields }
    : { state: "ready", reasons: [], ...advisoryFields };
}

// ---------------------------------------------------------------------------
// Stage 4 — Review-flow surfaces built on the same facts.
// ---------------------------------------------------------------------------

export type RemovalMeasurementDateFixTarget =
  | "productionRuns"
  | "labSamples"
  | "applications"
  | "productionRunsAndApplications"
  | "productionRunsAndLabSamples"
  | "applicationsAndLabSamples"
  | "productionRunsApplicationsAndLabSamples";

export type RemovalFixTarget =
  | RemovalMeasurementDateFixTarget
  | "feedstockTypes";

function evidenceRequirementCheck(facts: RemovalReadinessFacts) {
  const detail = evidenceMirrorDetail(facts);
  if (!detail) return null;
  const status: RemovalRequirementCheck["status"] =
    (facts.mirroredDocumentCount ?? 0) <
    (facts.supportingDocumentCount ?? 0)
      ? "warning"
      : "met";
  return {
    key: "evidence" as const,
    label: EVIDENCE_LABEL,
    status,
    detail,
  };
}

const FEEDSTOCK_TYPE_MAPPING_LABEL = "Feedstock types linked to Isometric";

interface FeedstockTypeMappingCheckBase {
  key: "feedstockTypeMapping";
  label: string;
  status: RemovalRequirementCheck["status"];
  detail?: string;
  fixTarget?: "feedstockTypes";
  fixTargetId?: string;
}

function feedstockTypeMappingCheck(
  facts: RemovalReadinessFacts,
): FeedstockTypeMappingCheckBase {
  if (!facts.hasMapping || !templateResolvesCleanly(facts)) {
    return {
      key: "feedstockTypeMapping",
      label: FEEDSTOCK_TYPE_MAPPING_LABEL,
      status: "skipped",
    };
  }
  const gaps = facts.feedstockTypeMappingGaps;
  return gaps.length === 0
    ? {
        key: "feedstockTypeMapping",
        label: FEEDSTOCK_TYPE_MAPPING_LABEL,
        status: "met",
      }
    : {
        key: "feedstockTypeMapping",
        label: FEEDSTOCK_TYPE_MAPPING_LABEL,
        status: "unmet",
        detail: gaps.map(describeFeedstockTypeMappingGap).join(" · "),
        fixTarget: "feedstockTypes",
        fixTargetId: gaps[0]?.feedstockTypeId,
      };
}

/** Selects the repair destination for the measurement-date requirements row. */
function measurementDateFixTarget(
  measurements: readonly string[],
): RemovalMeasurementDateFixTarget | undefined {
  const hasProductionRuns = measurements.some((measurement) =>
    measurement.startsWith("Production run "),
  );
  const hasApplications = measurements.some((measurement) =>
    measurement.startsWith("Application "),
  );
  const hasSamples = measurements.some((measurement) =>
    measurement.startsWith("Sample "),
  );
  if (hasProductionRuns && hasApplications && hasSamples) {
    return "productionRunsApplicationsAndLabSamples";
  }
  if (hasProductionRuns && hasSamples) {
    return "productionRunsAndLabSamples";
  }
  if (hasApplications && hasSamples) {
    return "applicationsAndLabSamples";
  }
  if (hasSamples) {
    return "labSamples";
  }
  if (hasProductionRuns && hasApplications) {
    return "productionRunsAndApplications";
  }
  if (hasProductionRuns) {
    return "productionRuns";
  }
  if (hasApplications) {
    return "applications";
  }
  return undefined;
}

function measurementDatesCheck(facts: RemovalReadinessFacts): {
  key: "measurementDates";
  label: string;
  fixTarget?: RemovalMeasurementDateFixTarget;
  status: RemovalRequirementCheck["status"];
  detail?: string;
} {
  const measurements = facts.futureDatedMeasurements ?? [];
  if (measurements.length === 0) {
    return {
      key: "measurementDates",
      label: MEASUREMENT_DATES_LABEL,
      status: facts.hasSubmittableRuns ? "met" : "skipped",
    };
  }
  return {
    key: "measurementDates",
    label: MEASUREMENT_DATES_LABEL,
    fixTarget: measurementDateFixTarget(measurements),
    status: "unmet",
    detail: measurements
      .slice(0, FUTURE_DATE_CHECK_DISPLAY_LIMIT)
      .map(futureDatedMeasurementSummary)
      .join(" · "),
  };
}

// ---------------------------------------------------------------------------
// New-Removal wizard — the "requirements" step's facility-level subset.
// ---------------------------------------------------------------------------

const TRANSPORT_UNIFORMITY_LABEL = "Transport legs aggregate cleanly";

export type RemovalRequirementKey =
  | "mapping"
  | "credentials"
  | "template"
  | "transport"
  | "transportUniformity"
  | "production"
  | "measurementDates"
  | "feedstockTypeMapping"
  | "entityReadiness"
  | "evidence"
  | "durability";

export interface RemovalRequirementCheck {
  key: RemovalRequirementKey;
  lineageIssues?: SubmissionLineageBlocker[];
  /** Affirmative label — what's true when the check is met. */
  label: string;
  /**
   * Plain-language requirement, identical across every readiness surface
   * (Phase 0). Attached uniformly from `CERT_REQUIREMENT_META`.
   */
  requirementLabel: string;
  /** Protocol/lab context for the ⓘ "Why?" affordance (Phase 1). */
  whyDetail?: string;
  /**
   * Typed destination for repairing a future measurement date. Mixed blocker
   * kinds intentionally leave this unset rather than linking to the wrong list.
   */
  fixTarget?: RemovalFixTarget;
  /** Local record to open when the fix target supports an exact edit link. */
  fixTargetId?: string;
  transportCategory?: TransportCategory;
  /** Removal template blocker codes behind an unmet template check, for its fix links. */
  templateBlockerCodes?: RemovalTemplateBlockerCode[];
  status: "met" | "unmet" | "skipped" | "warning";
  /** The blocker text when unmet, or context when met/skipped. */
  detail?: string;
}

type RemovalRequirementCheckBase = Omit<
  RemovalRequirementCheck,
  "requirementLabel" | "whyDetail"
>;

function withRequirementMeta(
  check: RemovalRequirementCheckBase,
): RemovalRequirementCheck {
  const meta = CERT_REQUIREMENT_META[check.key];
  return {
    ...check,
    requirementLabel: meta.requirementLabel,
    whyDetail: meta.whyDetail,
  };
}

/**
 * The New-Removal wizard's requirements step shows only the checks that are NOT
 * a single batch's concern (design doc §3): facility setup (project mapping +
 * pinned template) and the cross-batch transport uniformity that can only be
 * judged once batches are pooled into a removal, plus any production or entity
 * readiness blockers that can appear when an existing removal is resumed.
 * Transport-leg presence remains a batch-health concern. Pure projection of the
 * same facts used by the readiness classifier.
 */
export function buildRemovalRequirementsChecklist(
  facts: RemovalReadinessFacts,
): RemovalRequirementCheck[] {
  const linked = facts.hasMapping;
  const credentialsConfigured = facts.hasOrgCredentials;
  const templateClean =
    credentialsConfigured && templateResolvesCleanly(facts);

  const uniformity = ((): RemovalRequirementCheckBase[] => {
    // Uniformity is only meaningful once the template chain resolves and legs
    // are actually present (presence is the batch's concern, not this step's).
    if (!linked || !templateClean) {
      return [{
        key: "transportUniformity",
        label: TRANSPORT_UNIFORMITY_LABEL,
        status: "skipped",
      }];
    }
    const blocked = facts.requiredTransport.filter(
      (t): t is TransportCoverageFact & { aggregationWarning: string } =>
        t.count > 0 && t.aggregationWarning !== null,
    );
    return blocked.length === 0
      ? [{ key: "transportUniformity", label: TRANSPORT_UNIFORMITY_LABEL, status: "met" }]
      : blocked.map((t) => ({
          key: "transportUniformity",
          label: TRANSPORT_UNIFORMITY_LABEL,
          status: "unmet",
          transportCategory: t.category,
          detail: t.aggregationWarning,
        }));
  })();

  const transport = ((): RemovalRequirementCheckBase[] => {
    if (!linked || !templateClean) {
      return [{
        key: "transport",
        label: TRANSPORT_COVERAGE_LABEL,
        status: "skipped",
      }];
    }
    const missing = facts.requiredTransport
      .filter((category) => category.count === 0 || (category.missingEntityIds?.length ?? 0) > 0)
      .map((category) => category.category);
    return missing.length === 0
      ? [{
          key: "transport",
          label: TRANSPORT_COVERAGE_LABEL,
          status: "met",
        }]
      : missing.map((category) => ({
          key: "transport",
          label: TRANSPORT_COVERAGE_LABEL,
          status: "unmet",
          transportCategory: category,
          lineageIssues: facts.requiredTransport.find(fact => fact.category === category)?.lineageIssues,
          detail: `Missing ${category} transport legs`,
        }));
  })();

  const entityReadiness = ((): RemovalRequirementCheckBase => {
    const gaps = [...(facts.submissionLineageIssues?.map((issue) => issue.detail) ?? []), ...(facts.entityReadinessGaps ?? [])];
    return gaps.length === 0
      ? {
          key: "entityReadiness",
          label: ENTITY_READINESS_LABEL,
          status: "met",
        }
      : {
          key: "entityReadiness",
          label: ENTITY_READINESS_LABEL,
          status: "unmet",
          lineageIssues: facts.submissionLineageIssues,
          detail: gaps
            .slice(0, ENTITY_READINESS_CHECK_DISPLAY_LIMIT)
            .join(" · "),
        };
  })();

  const feedstockTypeMapping = feedstockTypeMappingCheck(facts);

  const production: RemovalRequirementCheckBase = {
    key: "production",
    label: "Production lineage complete",
    status: facts.hasSubmittableRuns ? "met" : "unmet",
    detail: facts.hasSubmittableRuns
      ? undefined
      : productionGapDetail(facts),
  };

  const durability = ((): RemovalRequirementCheckBase => {
    // Sampling/eligibility is a run-level concern batch health does not cover,
    // so a "ready" batch can still carry an unsampled run — surface it here.
    // Derived from runs, so skip when there is nothing to submit.
    if (!facts.hasSubmittableRuns) {
      return { key: "durability", label: DURABILITY_LABEL, status: "skipped" };
    }
    const blockers = [...(facts.durabilityConfigurationBlockers ?? []), ...(facts.durabilityGateBlockers ?? [])];
    return blockers.length === 0
      ? { key: "durability", label: DURABILITY_LABEL, status: "met" }
      : {
          key: "durability",
          label: DURABILITY_LABEL,
          status: "unmet",
          detail: blockers
            .slice(0, DURABILITY_BLOCKER_CHECK_DISPLAY_LIMIT)
            .join(" · "),
        };
  })();

  const checks: Array<RemovalRequirementCheckBase | null> = [
    {
      key: "mapping",
      label: "Facility linked to an Isometric project",
      status: linked ? "met" : "unmet",
      detail: linked ? undefined : NOT_LINKED_REASON,
    },
    {
      key: "credentials",
      label: ORG_CREDENTIALS_LABEL,
      status: !linked
        ? "skipped"
        : credentialsConfigured
          ? "met"
          : "unmet",
      detail:
        linked && !credentialsConfigured
          ? NO_ORG_CREDENTIALS_REASON
          : undefined,
    },
    {
      key: "template",
      label: "Removal template resolved",
      status:
        !linked || !credentialsConfigured
          ? "skipped"
          : templateClean
            ? "met"
            : "unmet",
      detail:
        !linked || !credentialsConfigured
          ? undefined
          : (templateBlockerReason(facts) ?? undefined),
      ...(linked && credentialsConfigured && facts.templateBlockers?.length
        ? { templateBlockerCodes: facts.templateBlockers.map((blocker) => blocker.code) }
        : {}),
    },
    ...transport,
    ...uniformity,
    production,
    measurementDatesCheck(facts),
    feedstockTypeMapping,
    entityReadiness,
    evidenceRequirementCheck(facts),
    durability,
  ];
  return checks
    .filter((check): check is RemovalRequirementCheckBase => check !== null)
    .map(withRequirementMeta);
}

/**
 * Whether a removal's credit-batch membership can still be changed. Mirrors the
 * server guard (`assertRemovalAllowsCreditBatchMutation`):
 * a removal with a live (`draft`/`submitted`/`accepted`) or in-flight ledger
 * row is frozen — regrouping it would change what an existing Isometric Removal
 * represents (ADR 0003). The server is authoritative; this only gates the UI so
 * blocked controls aren't offered.
 */
export function canRegroupRemoval({
  local,
  lockInFlight,
}: {
  local: LocalSubmissionStatus | null;
  lockInFlight: boolean;
}): boolean {
  if (lockInFlight) return false;
  if (local === null) return true;
  return !BLOCKING_SUBMISSION_STATUSES.includes(local);
}
