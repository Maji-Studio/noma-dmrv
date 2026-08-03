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
 * raw durability gates + its single-batch certify context) and feeds
 * them in; this module only makes the verdict. The split mirrors
 * readiness.ts / readiness-facts.ts so the wizard, the detail page, and any
 * overview hint can never disagree on whether a batch is "ready".
 */

import type { TransportCategory } from "./readiness";
import {
  defaultProductionReadinessGap,
  type ProductionReadinessGap,
} from "./production-readiness";
import { CERT_REQUIREMENT_META } from "./requirement-labels";

export type BatchHealthState =
  | "ready" // every applicable batch-level check is met — selectable
  | "incomplete"; // one or more checks unmet (see `checks`)

export type BatchHealthCheckKey =
  | "carbon" // carbon & durability lab inputs resolved
  | "facilityEmissions" // facility emission-estimate inputs resolved
  | "production" // lineage resolves >= 1 production run
  | "transport" // transport legs present for the template's required categories
  | "entityReadiness"; // certifier-required entity fields on the batch's own lineage

export type BatchHealthFixTarget =
  | "batchDetails"
  | "deliveries"
  | "deliveryDistances"
  | "feedstocks"
  | "productionRuns"
  | "biocharProducts"
  | "labSamples"
  | "certificationEmissions"
  | "applications"
  | "sourceData";

export type BatchHealthCheckStatus =
  | "met" // satisfied
  | "unmet" // failed — see `detail`
  | "skipped"; // not yet evaluable (facility setup incomplete) — does not block

export interface BatchHealthCheck {
  key: BatchHealthCheckKey;
  /** Affirmative label — what's true when the check is met. */
  label: string;
  /**
   * Plain-language requirement, identical across every readiness surface
   * (Phase 0). Rendered instead of `label` so a batch's gaps read the same on
   * the batch page and in the removal wizard. Attached uniformly in
   * `deriveBatchHealth` from `CERT_REQUIREMENT_META`.
   */
  requirementLabel: string;
  /** Protocol/lab context for the ⓘ "Why?" affordance (Phase 1). */
  whyDetail?: string;
  status: BatchHealthCheckStatus;
  /** Missing items when unmet, or context when skipped/met. */
  detail?: string;
  /** UI hint for the most specific workflow that resolves an unmet check. */
  fixTarget?: BatchHealthFixTarget;
  /** Stable discriminator when one requirement expands into workflow issues. */
  issueKey?: string;
  /** Records that must be fixed in this check's single destination. */
  affectedRecords?: BatchHealthAffectedRecord[];
}

export interface BatchHealthAffectedRecord {
  id: string;
  code: string;
  missing: string[];
}

export interface BatchEntityReadinessIssue {
  key: string;
  label: string;
  fixTarget: BatchHealthFixTarget;
  affectedRecords: BatchHealthAffectedRecord[];
}

/**
 * The per-check builders below construct everything except the shared
 * requirement metadata, which `deriveBatchHealth` attaches uniformly from
 * `CERT_REQUIREMENT_META` so it can never drift per check.
 */
type BatchHealthCheckBase = Omit<
  BatchHealthCheck,
  "requirementLabel" | "whyDetail"
> & {
  requirementLabel?: string;
};

export interface BatchTransportFact {
  category: TransportCategory;
  /** At least one transport leg present for this category in the batch lineage. */
  present: boolean;
}

export interface BatchHealthFacts {
  /**
   * Raw carbon and durability lab-input blockers (sample carbon content,
   * H/C_org, O/C_org, total carbon, s_fraction, and replicate coverage).
   * No local CO₂e preview is involved; empty means the raw gates are complete.
   */
  carbonMissingInputs: string[];
  /**
   * Facility-level emission-estimate blockers that apply to this batch's
   * durability tier, such as a missing reference soil temperature.
   */
  facilityEmissionsBlockers: string[];
  /**
   * Per-entity certifier-readiness gaps from THIS batch's own lineage (its
   * production runs, samples, and transport legs resolve 1:1 for an ungrouped
   * batch). A batch whose underlying entities are missing certifier-required
   * fields genuinely can't be certified, so these gaps block selection — the
   * operator resolves them from the batch's cards before grouping.
   */
  entityReadinessGaps: string[];
  /** The same gaps grouped by the one workflow where each issue is resolved. */
  entityReadinessIssues?: BatchEntityReadinessIssue[];
  /** The batch's application lineage resolves at least one production run. */
  hasSubmittableRuns: boolean;
  /** Specific reason production lineage is not submittable, when known. */
  productionReadinessGap?: ProductionReadinessGap | null;
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
const FACILITY_EMISSIONS_LABEL = "Facility emission estimates complete";
const PRODUCTION_LABEL = "Production data linked";
const TRANSPORT_LABEL = "Transport legs present";
const ENTITY_READINESS_LABEL = "Entity certifier fields complete";
const ENTITY_READINESS_PREVIEW_LIMIT = 3;
const MERGED_CHECK_SEPARATOR = " · ";

function describeCategories(categories: TransportCategory[]): string {
  return categories.join(", ");
}

function carbonCheck(facts: BatchHealthFacts): BatchHealthCheckBase {
  const missingInputs = Array.from(
    new Set(facts.carbonMissingInputs.filter(Boolean)),
  );
  if (missingInputs.length === 0) {
    return { key: "carbon", label: CARBON_LABEL, status: "met" };
  }
  return {
    key: "carbon",
    label: CARBON_LABEL,
    status: "unmet",
    detail: `Missing: ${missingInputs.join(", ")}`,
    fixTarget: "labSamples",
  };
}

function facilityEmissionsChecks(
  facts: BatchHealthFacts,
): BatchHealthCheckBase[] {
  const blockers = Array.from(
    new Set(facts.facilityEmissionsBlockers.filter(Boolean)),
  );
  if (blockers.length === 0) return [];
  return [{
    key: "facilityEmissions",
    label: FACILITY_EMISSIONS_LABEL,
    status: "unmet",
    detail: blockers.join(" · "),
    fixTarget: "certificationEmissions",
  }];
}

function productionCheck(facts: BatchHealthFacts): BatchHealthCheckBase {
  if (facts.hasSubmittableRuns) {
    return { key: "production", label: PRODUCTION_LABEL, status: "met" };
  }
  const gap = facts.productionReadinessGap ?? defaultProductionReadinessGap();
  return {
    key: "production",
    label: PRODUCTION_LABEL,
    status: "unmet",
    detail: gap.detail,
    fixTarget: gap.fixTarget,
  };
}

function transportCheck(facts: BatchHealthFacts): BatchHealthCheckBase {
  // Transport coverage is derived from application → delivery → product → run
  // lineage. Until that lineage exists, an empty transport result is only a
  // downstream symptom of the production gap and has no honest destination.
  if (!facts.hasSubmittableRuns) {
    return {
      key: "transport",
      label: TRANSPORT_LABEL,
      status: "skipped",
      detail: "Link production data before reviewing transport coverage",
    };
  }
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
        fixTarget: "deliveries",
      };
}

function resolutionDestination(check: BatchHealthCheck): string {
  switch (check.fixTarget) {
    case "deliveries":
    case "deliveryDistances":
      return "deliveries";
    case "productionRuns":
    case "sourceData":
      return "productionRuns";
    default:
      return check.fixTarget ?? check.key;
  }
}

function mergeAffectedRecords(
  left: BatchHealthAffectedRecord[] | undefined,
  right: BatchHealthAffectedRecord[] | undefined,
): BatchHealthAffectedRecord[] | undefined {
  const records = new Map<string, BatchHealthAffectedRecord>();
  for (const record of [...(left ?? []), ...(right ?? [])]) {
    const current = records.get(record.id);
    records.set(record.id, {
      ...record,
      missing: Array.from(
        new Set([...(current?.missing ?? []), ...record.missing]),
      ),
    });
  }
  return records.size > 0 ? Array.from(records.values()) : undefined;
}

function mergeCheckText(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  const parts = [left, right]
    .flatMap((value) => value?.split(MERGED_CHECK_SEPARATOR) ?? [])
    .filter(Boolean);
  const unique = Array.from(new Set(parts));
  return unique.length > 0 ? unique.join(MERGED_CHECK_SEPARATOR) : undefined;
}

/** One open row and primary action per resolution destination. */
function mergeUnmetChecksByDestination(
  checks: BatchHealthCheck[],
): BatchHealthCheck[] {
  const merged: BatchHealthCheck[] = [];
  const indexByDestination = new Map<string, number>();

  for (const check of checks) {
    if (check.status !== "unmet") {
      merged.push(check);
      continue;
    }
    const destination = resolutionDestination(check);
    const existingIndex = indexByDestination.get(destination);
    if (existingIndex === undefined) {
      indexByDestination.set(destination, merged.length);
      merged.push(check);
      continue;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      label: mergeCheckText(existing.label, check.label) ?? existing.label,
      requirementLabel:
        mergeCheckText(existing.requirementLabel, check.requirementLabel) ??
        existing.requirementLabel,
      whyDetail: mergeCheckText(existing.whyDetail, check.whyDetail),
      issueKey: [existing.issueKey ?? existing.key, check.issueKey ?? check.key]
        .join("+"),
      detail: mergeCheckText(existing.detail, check.detail),
      affectedRecords: mergeAffectedRecords(
        existing.affectedRecords,
        check.affectedRecords,
      ),
    };
  }
  return merged;
}

function entityReadinessChecks(facts: BatchHealthFacts): BatchHealthCheckBase[] {
  if (facts.entityReadinessGaps.length === 0) {
    return [{
      key: "entityReadiness",
      label: ENTITY_READINESS_LABEL,
      status: "met",
      detail: "No entity field gaps detected for submission.",
    }];
  }
  const issues = facts.entityReadinessIssues;
  if (issues && issues.length > 0) {
    return issues.map((issue) => ({
      key: "entityReadiness",
      issueKey: issue.key,
      label: ENTITY_READINESS_LABEL,
      requirementLabel: issue.label,
      status: "unmet",
      detail: `${issue.affectedRecords.length} ${issue.affectedRecords.length === 1 ? "record needs" : "records need"} attention`,
      fixTarget: issue.fixTarget,
      affectedRecords: issue.affectedRecords,
    }));
  }
  const suffix =
    facts.entityReadinessGaps.length > ENTITY_READINESS_PREVIEW_LIMIT
      ? ", ..."
      : "";
  return [{
    key: "entityReadiness",
    label: ENTITY_READINESS_LABEL,
    status: "unmet",
    detail: `Missing: ${facts.entityReadinessGaps
      .slice(0, ENTITY_READINESS_PREVIEW_LIMIT)
      .join(", ")}${suffix}`,
  }];
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
  const checks = mergeUnmetChecksByDestination(
    [
      carbonCheck(facts),
      ...facilityEmissionsChecks(facts),
      productionCheck(facts),
      transportCheck(facts),
      ...entityReadinessChecks(facts),
    ].map(withRequirementMeta),
  );
  const issueCount = checks.filter((c) => c.status === "unmet").length;
  return {
    state: issueCount > 0 ? "incomplete" : "ready",
    issueCount,
    checks,
  };
}

// Attach the one plain-language requirement label (+ why) every readiness
// surface renders — the same string on the batch page and in the removal
// wizard, so a batch's gaps can never read one way in one place and another in
// the other.
function withRequirementMeta(check: BatchHealthCheckBase): BatchHealthCheck {
  const meta = CERT_REQUIREMENT_META[check.key];
  return {
    ...check,
    requirementLabel: check.requirementLabel ?? meta.requirementLabel,
    whyDetail: meta.whyDetail,
  };
}
