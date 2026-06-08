/**
 * Per-credit-batch health classifier — the pure decision behind "is this batch
 * complete enough to group into a removal, and if not, what's missing?" It is
 * the batch-grain sibling of `deriveRemovalReadiness` (./readiness): that module
 * judges a whole removal's facility-level + aggregate preconditions; this one
 * judges a SINGLE batch's own data completeness, so the New-Removal wizard only
 * offers batches whose data is ready and the batch detail page can show exactly
 * what is still outstanding.
 *
 * Strictly client-safe: depends only on the `TransportCategory` type from
 * `./readiness` and plain primitives. A server loader gathers the facts (from
 * the batch's CO2e-stored preview + its single-batch certify context) and feeds
 * them in; this module only makes the verdict. The split mirrors
 * readiness.ts / readiness-facts.ts so the wizard, the detail page, and any
 * overview hint can never disagree on whether a batch is "ready".
 */

import type { TransportCategory } from "./readiness";

export type BatchHealthState =
  | "ready" // every applicable batch-level check is met — selectable
  | "incomplete"; // one or more checks unmet (see `checks`)

export type BatchHealthCheckKey =
  | "carbon" // carbon & durability lab inputs resolved
  | "production" // lineage resolves >= 1 production run
  | "transport" // transport legs present for the template's required categories
  | "entityReadiness"; // certifier-required entity fields on the batch's own lineage

export type BatchHealthCheckStatus =
  | "met" // satisfied
  | "unmet" // failed — see `detail`
  | "skipped"; // not yet evaluable (facility setup incomplete) — does not block

export interface BatchHealthCheck {
  key: BatchHealthCheckKey;
  /** Affirmative label — what's true when the check is met. */
  label: string;
  status: BatchHealthCheckStatus;
  /** Missing items when unmet, or context when skipped/met. */
  detail?: string;
}

export interface BatchTransportFact {
  category: TransportCategory;
  /** At least one transport leg present for this category in the batch lineage. */
  present: boolean;
}

export interface BatchHealthFacts {
  /**
   * Carbon & durability lab inputs, derived from the batch's CO2e-stored
   * preview. These are human-readable labels of what the preview could not
   * resolve (sample carbon content, durability lab inputs, …); empty ⇒ complete.
   */
  carbonMissingInputs: string[];
  /**
   * Per-entity certifier-readiness gaps from THIS batch's own lineage (its
   * production runs, samples, and transport legs resolve 1:1 for an ungrouped
   * batch). A batch whose underlying entities are missing certifier-required
   * fields genuinely can't be certified, so these gaps block selection — the
   * operator resolves them from the batch's cards before grouping.
   */
  entityReadinessGaps: string[];
  /** The batch's application lineage resolves at least one production run. */
  hasSubmittableRuns: boolean;
  /**
   * The facility is set up on Isometric (project mapping + a cleanly-resolving
   * default template). Transport requirements come from the template, so
   * transport coverage is only evaluable once this is true.
   */
  facilitySetupComplete: boolean;
  /**
   * Transport coverage for the categories the facility's default template
   * requires. Empty when the template requires none — or when facility setup is
   * incomplete (transport then reports `skipped`).
   */
  requiredTransport: BatchTransportFact[];
}

export interface BatchHealth {
  state: BatchHealthState;
  /** Count of `unmet` checks; `skipped` checks do not count. */
  issueCount: number;
  checks: BatchHealthCheck[];
}

const CARBON_LABEL = "Carbon & durability inputs complete";
const PRODUCTION_LABEL = "Production data linked";
const TRANSPORT_LABEL = "Transport legs present";
const ENTITY_READINESS_LABEL = "Entity certifier fields complete";
const ENTITY_READINESS_PREVIEW_LIMIT = 3;

function describeCategories(categories: TransportCategory[]): string {
  return categories.join(", ");
}

function carbonCheck(facts: BatchHealthFacts): BatchHealthCheck {
  if (facts.carbonMissingInputs.length === 0) {
    return { key: "carbon", label: CARBON_LABEL, status: "met" };
  }
  return {
    key: "carbon",
    label: CARBON_LABEL,
    status: "unmet",
    detail: `Missing: ${facts.carbonMissingInputs.join(", ")}`,
  };
}

function productionCheck(facts: BatchHealthFacts): BatchHealthCheck {
  return facts.hasSubmittableRuns
    ? { key: "production", label: PRODUCTION_LABEL, status: "met" }
    : {
        key: "production",
        label: PRODUCTION_LABEL,
        status: "unmet",
        detail: "No production data linked yet — nothing to certify",
      };
}

function transportCheck(facts: BatchHealthFacts): BatchHealthCheck {
  // Required categories come from the facility's default template; without a
  // resolved facility setup we cannot know them, so the check is not yet
  // evaluable. The wizard surfaces the facility-setup gap separately, so a
  // `skipped` transport check must NOT block batch readiness.
  if (!facts.facilitySetupComplete) {
    return {
      key: "transport",
      label: TRANSPORT_LABEL,
      status: "skipped",
      detail: "Complete facility setup to evaluate transport coverage",
    };
  }
  if (facts.requiredTransport.length === 0) {
    return {
      key: "transport",
      label: TRANSPORT_LABEL,
      status: "met",
      detail: "This template requires no transport legs.",
    };
  }
  const missing = facts.requiredTransport
    .filter((t) => !t.present)
    .map((t) => t.category);
  return missing.length === 0
    ? { key: "transport", label: TRANSPORT_LABEL, status: "met" }
    : {
        key: "transport",
        label: TRANSPORT_LABEL,
        status: "unmet",
        detail: `Missing ${describeCategories(missing)} transport legs`,
      };
}

function entityReadinessCheck(facts: BatchHealthFacts): BatchHealthCheck {
  if (facts.entityReadinessGaps.length === 0) {
    return {
      key: "entityReadiness",
      label: ENTITY_READINESS_LABEL,
      status: "met",
      detail: "No entity field gaps detected for submission.",
    };
  }
  const suffix =
    facts.entityReadinessGaps.length > ENTITY_READINESS_PREVIEW_LIMIT
      ? ", ..."
      : "";
  return {
    key: "entityReadiness",
    label: ENTITY_READINESS_LABEL,
    status: "unmet",
    detail: `Missing: ${facts.entityReadinessGaps
      .slice(0, ENTITY_READINESS_PREVIEW_LIMIT)
      .join(", ")}${suffix}`,
  };
}

/**
 * Folds a batch's data-completeness facts into one verdict + an itemised
 * checklist. A batch is "ready" (selectable into a removal) when no `unmet`
 * check remains — carbon inputs, production lineage, transport-leg presence, and
 * the batch's own entity certifier fields all gate selection, so the wizard only
 * ever offers a batch that can actually be certified. Only `skipped` checks
 * (transport when facility setup isn't done — the wizard surfaces that gap
 * separately) are non-blocking. Facility-level concerns that aren't a single
 * batch's data (project mapping, template resolution, cross-batch transport
 * uniformity) live in `deriveRemovalReadiness`, not here.
 */
export function deriveBatchHealth(facts: BatchHealthFacts): BatchHealth {
  const checks = [
    carbonCheck(facts),
    productionCheck(facts),
    transportCheck(facts),
    entityReadinessCheck(facts),
  ];
  const issueCount = checks.filter((c) => c.status === "unmet").length;
  return {
    state: issueCount > 0 ? "incomplete" : "ready",
    issueCount,
    checks,
  };
}
