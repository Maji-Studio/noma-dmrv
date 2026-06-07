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

import {
  BLOCKING_SUBMISSION_STATUSES,
  deriveRemovalStatus,
  type LocalSubmissionStatus,
} from "./status";

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
  /** A per-leg uniformity/completeness warning from aggregation, if any. */
  hasAggregationWarning: boolean;
}

export interface RemovalReadinessFacts {
  /** Latest ledger status, or null when no submission row exists yet. */
  local: LocalSubmissionStatus | null;
  /** A draft row holding a live submission lock. */
  lockInFlight: boolean;
  /** The facility is linked to an Isometric project. */
  hasMapping: boolean;
  /** The facility's default removal template resolved on Isometric. */
  hasDefaultTemplate: boolean;
  /** Set when a configured template id no longer exists on Isometric. */
  missingDefaultTemplateId: string | null;
  /** Template blueprint keys with no matching component blueprint. */
  unresolvedBlueprintKeys: string[];
  /** Production runs resolved from member-batch lineage — false ⇒ nothing to submit. */
  hasSubmittableRuns: boolean;
  /** Coverage facts for the template's required transport categories only. */
  requiredTransport: TransportCoverageFact[];
  /** Compact labels from per-entity certifier-readiness checks. */
  entityReadinessGaps?: string[];
}

export interface RemovalReadiness {
  state: RemovalReadinessState;
  /** Human-readable blocker reasons; empty unless state === "blocked". */
  reasons: string[];
}

const NOT_LINKED_REASON = "Facility not linked to an Isometric project";
const NO_PRODUCTION_REASON = "No production data linked yet — nothing to submit";
const TRANSPORT_COVERAGE_LABEL = "Transport coverage complete";
const ENTITY_READINESS_LABEL = "Entity certifier fields complete";
const ENTITY_READINESS_REASON_PREVIEW_LIMIT = 3;
const ENTITY_READINESS_PREFLIGHT_DISPLAY_LIMIT = 5;

function describeCategories(categories: TransportCategory[]): string {
  return categories.join(", ");
}

// The one canonical template-resolution blocker reason. Returns null when the
// template chain resolves cleanly. Shared by the classifier and the pre-flight
// checklist so the two never phrase the same blocker differently.
function templateBlockerReason(facts: RemovalReadinessFacts): string | null {
  if (facts.missingDefaultTemplateId) {
    return `Default removal template ${facts.missingDefaultTemplateId} is no longer available`;
  }
  if (!facts.hasDefaultTemplate) {
    return "No default removal template selected for this facility";
  }
  if (facts.unresolvedBlueprintKeys.length > 0) {
    const n = facts.unresolvedBlueprintKeys.length;
    return `Template references ${n} unresolved blueprint${n === 1 ? "" : "s"}`;
  }
  return null;
}

function templateResolvesCleanly(facts: RemovalReadinessFacts): boolean {
  return (
    facts.hasDefaultTemplate &&
    !facts.missingDefaultTemplateId &&
    facts.unresolvedBlueprintKeys.length === 0
  );
}

// Transport-coverage gaps, phrased exactly as the classifier's blocker reasons.
function transportGapReasons(required: TransportCoverageFact[]): string[] {
  const missing = required.filter((t) => t.count === 0).map((t) => t.category);
  const incomplete = required
    .filter((t) => t.count > 0 && t.hasAggregationWarning)
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

/**
 * Folds removal status + submission preconditions into one verdict.
 * Precedence: live lock → terminal (submitted/superseded) → blocked → ready.
 */
export function deriveRemovalReadiness(
  facts: RemovalReadinessFacts,
): RemovalReadiness {
  if (facts.lockInFlight) return { state: "inProgress", reasons: [] };

  // Status drives the high end. `isTerminal` covers submitted/superseded — a
  // removal is "done" at submitted (no remote lifecycle exists; see status.ts).
  const status = deriveRemovalStatus({ local: facts.local, lockInFlight: false });
  if (status.isTerminal) return { state: "submitted", reasons: [] };

  // Not submitted yet (null / draft / rejected) → evaluate preconditions.
  if (!facts.hasMapping) {
    // Without a project link every downstream fact is empty; one clear reason.
    return { state: "blocked", reasons: [NOT_LINKED_REASON] };
  }

  const reasons: string[] = [];

  const templateReason = templateBlockerReason(facts);
  if (templateReason) reasons.push(templateReason);

  // Transport requirements come from the template, so only judge coverage once
  // the template chain resolves cleanly.
  if (templateResolvesCleanly(facts)) {
    reasons.push(...transportGapReasons(facts.requiredTransport));
  }

  if (!facts.hasSubmittableRuns) {
    reasons.push(NO_PRODUCTION_REASON);
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

  return reasons.length > 0
    ? { state: "blocked", reasons }
    : { state: "ready", reasons: [] };
}

// ---------------------------------------------------------------------------
// Stage 4 — Review-flow surfaces built on the same facts.
// ---------------------------------------------------------------------------

export type PreflightCheckStatus =
  | "met" // precondition satisfied
  | "unmet" // precondition failed — see `detail`
  | "skipped"; // not yet evaluable (an upstream check is unmet)

export interface PreflightCheck {
  key: "mapping" | "template" | "transport" | "production" | "entityReadiness";
  /** Affirmative label — what's true when the check is met. */
  label: string;
  status: PreflightCheckStatus;
  /** The blocker text when unmet, or context when met/skipped. */
  detail?: string;
}

/**
 * The pre-flight step's itemised checklist — the same preconditions the
 * classifier folds into one verdict, broken out per row so the operator sees
 * exactly what's satisfied and what isn't. Pure: a deterministic projection of
 * the readiness facts (the submission-status precedence is the orchestrator's
 * job; this only judges preconditions). This is the canonical pre-flight
 * source the credit-batch panel's inline blocker copy is superseded by.
 */
export function buildRemovalPreflightChecklist(
  facts: RemovalReadinessFacts,
): PreflightCheck[] {
  const linked = facts.hasMapping;
  const templateClean = templateResolvesCleanly(facts);

  const transport = ((): PreflightCheck => {
    if (!linked || !templateClean) {
      return {
        key: "transport",
        label: TRANSPORT_COVERAGE_LABEL,
        status: "skipped",
      };
    }
    if (facts.requiredTransport.length === 0) {
      return {
        key: "transport",
        label: TRANSPORT_COVERAGE_LABEL,
        status: "met",
        detail: "This template requires no transport legs.",
      };
    }
    const gaps = transportGapReasons(facts.requiredTransport);
    return gaps.length === 0
      ? { key: "transport", label: TRANSPORT_COVERAGE_LABEL, status: "met" }
      : {
          key: "transport",
          label: TRANSPORT_COVERAGE_LABEL,
          status: "unmet",
          detail: gaps.join(" · "),
        };
  })();

  const entityReadiness = ((): PreflightCheck => {
    const gaps = facts.entityReadinessGaps ?? [];
    return gaps.length === 0
      ? { key: "entityReadiness", label: ENTITY_READINESS_LABEL, status: "met" }
      : {
          key: "entityReadiness",
          label: ENTITY_READINESS_LABEL,
          status: "unmet",
          detail: gaps.slice(0, ENTITY_READINESS_PREFLIGHT_DISPLAY_LIMIT).join(" · "),
        };
  })();

  return [
    {
      key: "mapping",
      label: "Facility linked to an Isometric project",
      status: linked ? "met" : "unmet",
      detail: linked ? undefined : NOT_LINKED_REASON,
    },
    {
      key: "template",
      label: "Removal template resolved",
      status: !linked ? "skipped" : templateClean ? "met" : "unmet",
      detail: !linked ? undefined : (templateBlockerReason(facts) ?? undefined),
    },
    transport,
    {
      key: "production",
      label: "Production data linked",
      status: facts.hasSubmittableRuns ? "met" : "unmet",
      detail: facts.hasSubmittableRuns ? undefined : NO_PRODUCTION_REASON,
    },
    entityReadiness,
  ];
}

// ---------------------------------------------------------------------------
// New-Removal wizard — the "requirements" step's facility-level subset.
// ---------------------------------------------------------------------------

const TRANSPORT_UNIFORMITY_LABEL = "Transport legs aggregate cleanly";

export type RemovalRequirementKey =
  | "mapping"
  | "template"
  | "transportUniformity"
  | "entityReadiness";

export interface RemovalRequirementCheck {
  key: RemovalRequirementKey;
  /** Affirmative label — what's true when the check is met. */
  label: string;
  status: PreflightCheckStatus;
  /** The blocker text when unmet, or context when met/skipped. */
  detail?: string;
}

/**
 * The New-Removal wizard's requirements step shows only the checks that are NOT
 * a single batch's concern (design doc §3): facility setup (project mapping +
 * default template) and the cross-batch transport uniformity that can only be
 * judged once batches are pooled into a removal, plus entity certifier-readiness
 * gaps that submit readiness already blocks on. Batch-level checks — production
 * lineage and transport-leg PRESENCE — are the batch health check's job, so they
 * are deliberately excluded here even when unmet (the wizard only let ready
 * batches in, so they are already satisfied). Pure projection of the same facts
 * the full pre-flight uses, so the two never disagree on the shared rows.
 */
export function buildRemovalRequirementsChecklist(
  facts: RemovalReadinessFacts,
): RemovalRequirementCheck[] {
  const linked = facts.hasMapping;
  const templateClean = templateResolvesCleanly(facts);

  const uniformity = ((): RemovalRequirementCheck => {
    // Uniformity is only meaningful once the template chain resolves and legs
    // are actually present (presence is the batch's concern, not this step's).
    if (!linked || !templateClean) {
      return {
        key: "transportUniformity",
        label: TRANSPORT_UNIFORMITY_LABEL,
        status: "skipped",
      };
    }
    const mixed = facts.requiredTransport
      .filter((t) => t.count > 0 && t.hasAggregationWarning)
      .map((t) => t.category);
    return mixed.length === 0
      ? {
          key: "transportUniformity",
          label: TRANSPORT_UNIFORMITY_LABEL,
          status: "met",
        }
      : {
          key: "transportUniformity",
          label: TRANSPORT_UNIFORMITY_LABEL,
          status: "unmet",
          detail: `Mixed method/factor across ${describeCategories(mixed)} legs`,
        };
  })();

  const entityReadiness = ((): RemovalRequirementCheck => {
    const gaps = facts.entityReadinessGaps ?? [];
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
          detail: gaps
            .slice(0, ENTITY_READINESS_PREFLIGHT_DISPLAY_LIMIT)
            .join(" · "),
        };
  })();

  return [
    {
      key: "mapping",
      label: "Facility linked to an Isometric project",
      status: linked ? "met" : "unmet",
      detail: linked ? undefined : NOT_LINKED_REASON,
    },
    {
      key: "template",
      label: "Removal template resolved",
      status: !linked ? "skipped" : templateClean ? "met" : "unmet",
      detail: !linked ? undefined : (templateBlockerReason(facts) ?? undefined),
    },
    uniformity,
    entityReadiness,
  ];
}

/**
 * Whether a removal's credit-batch membership can still be changed. Mirrors the
 * server guard (`assignCreditBatchToRemoval` → `removalHasBlockingSubmission`):
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
