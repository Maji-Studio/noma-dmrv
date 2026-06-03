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

import { deriveRemovalStatus, type LocalSubmissionStatus } from "./status";

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
}

export interface RemovalReadiness {
  state: RemovalReadinessState;
  /** Human-readable blocker reasons; empty unless state === "blocked". */
  reasons: string[];
}

const NOT_LINKED_REASON = "Facility not linked to an Isometric project";

function describeCategories(categories: TransportCategory[]): string {
  return categories.join(", ");
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

  const templateClean =
    facts.hasDefaultTemplate &&
    !facts.missingDefaultTemplateId &&
    facts.unresolvedBlueprintKeys.length === 0;

  if (facts.missingDefaultTemplateId) {
    reasons.push(
      `Default removal template ${facts.missingDefaultTemplateId} is no longer available`,
    );
  } else if (!facts.hasDefaultTemplate) {
    reasons.push("No default removal template selected for this facility");
  } else if (facts.unresolvedBlueprintKeys.length > 0) {
    const n = facts.unresolvedBlueprintKeys.length;
    reasons.push(
      `Template references ${n} unresolved blueprint${n === 1 ? "" : "s"}`,
    );
  }

  // Transport requirements come from the template, so only judge coverage once
  // the template chain resolves cleanly.
  if (templateClean) {
    const missing = facts.requiredTransport
      .filter((t) => t.count === 0)
      .map((t) => t.category);
    const incomplete = facts.requiredTransport
      .filter((t) => t.count > 0 && t.hasAggregationWarning)
      .map((t) => t.category);
    if (missing.length > 0) {
      reasons.push(`Missing ${describeCategories(missing)} transport legs`);
    }
    if (incomplete.length > 0) {
      reasons.push(
        `Incomplete ${describeCategories(incomplete)} transport legs`,
      );
    }
  }

  if (!facts.hasSubmittableRuns) {
    reasons.push("No production data linked yet — nothing to submit");
  }

  return reasons.length > 0
    ? { state: "blocked", reasons }
    : { state: "ready", reasons: [] };
}
