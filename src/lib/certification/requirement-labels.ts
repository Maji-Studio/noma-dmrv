/**
 * One plain-language source for every certification readiness requirement
 * (Phase 0 of the removal/GHG "legible + guided" redesign, rides #246).
 *
 * The batch health classifier (`batch-health.ts`) and the removal readiness
 * checklists (`readiness.ts`) each carry their own affirmative `label` (what's
 * true once a check is met — "…complete", "…linked"), which reads as a
 * contradiction when shown next to a red warning ("…complete" while incomplete)
 * and drifted across surfaces (the batch page said "…missing" while the removal
 * wizard said "…complete" for the SAME check). This module gives every check a
 * single neutral `requirementLabel` — a plain statement of the requirement that
 * reads correctly with a ✓ or a ✗ — plus a `whyDetail` the ⓘ "Why?" affordance
 * expands (Phase 1). Every readiness surface renders `requirementLabel`, so they
 * can never phrase the same requirement differently again.
 *
 * Strictly client-safe: plain strings, no imports. Registry/lab vocabulary and
 * the reasoning live in `whyDetail` (tucked behind ⓘ), never on the primary
 * label. `whyDetail` is a non-authoritative operator explanation — the protocol
 * itself is the source of truth (see `.claude/CLAUDE.md` → Isometric).
 */

/**
 * The union of every readiness check key across the batch-health and removal
 * readiness families. Keeping one key space means both families read the same
 * plain-language entry for the concerns they share (transport, entity readiness).
 */
export type CertRequirementKey =
  | "carbon"
  | "facilityEmissions"
  | "production"
  | "measurementDates"
  | "transport"
  | "transportUniformity"
  | "entityReadiness"
  | "mapping"
  | "credentials"
  | "template"
  | "evidence"
  | "durability";

export interface CertRequirementMeta {
  /**
   * Plain-language name of the requirement — the ONE string every readiness
   * surface renders. Phrased so it reads correctly whether met (✓) or unmet (✗);
   * never "…complete"/"…missing" (those states are carried by the icon + detail).
   */
  requirementLabel: string;
  /**
   * The reasoning + protocol/registry vocabulary, surfaced only behind an ⓘ
   * "Why?" affordance (Phase 1) so the primary label stays plain.
   */
  whyDetail: string;
}

export const CERT_REQUIREMENT_META: Record<
  CertRequirementKey,
  CertRequirementMeta
> = {
  carbon: {
    requirementLabel: "Lab chemistry results",
    whyDetail:
      "The durability method needs lab chemistry for this batch's samples. For 1000-year credits that means mean random reflectance (R₀) and non-reactive carbon — each with its standard deviation — across at least three replicate samples. These figures set how much of the stored carbon can be claimed as permanent.",
  },
  facilityEmissions: {
    requirementLabel: "Facility reference soil temperature",
    whyDetail:
      "The 200-year durability calculation uses the facility's reference soil temperature to estimate the durable carbon fraction. Configure it in certification emission estimates before certifying affected batches.",
  },
  production: {
    requirementLabel: "Linked production data",
    whyDetail:
      "This batch's applications must trace back to at least one production run so the removal can attribute the pyrolysed biochar mass and its production emissions. With no linked run there is nothing to submit.",
  },
  measurementDates: {
    requirementLabel: "Production and application dates",
    whyDetail:
      "These dates tell Isometric when production finished and when the reporting period ended. Future dates cannot be submitted.",
  },
  transport: {
    requirementLabel: "Transport legs recorded",
    whyDetail:
      "Each transport step the registry template requires (moving feedstock in, biochar out) needs a recorded leg with mass and distance so its emissions can be accounted for. A missing category can't be estimated for you.",
  },
  transportUniformity: {
    requirementLabel: "Transport legs aggregate cleanly",
    whyDetail:
      "When several batches are pooled into one removal, their transport legs in each category must share a single method and emission factor. Mixed methods can't be rolled up into one tonne-kilometre figure, so the removal can't be submitted until they're consistent.",
  },
  entityReadiness: {
    requirementLabel: "Certifier fields on linked records",
    whyDetail:
      "The production runs, applications and samples behind this batch carry fields the certifier requires — telemetry readings, a geotagged application photo, and similar. Any missing field blocks the whole removal, so they're surfaced on the batch before it's grouped.",
  },
  mapping: {
    requirementLabel: "Facility linked to a registry project",
    whyDetail:
      "Removals are submitted into an Isometric project. Until this facility is linked to one in certification settings there is no registry destination, so nothing downstream can be evaluated.",
  },
  credentials: {
    requirementLabel: "Organization Isometric credentials",
    whyDetail:
      "Each organization uses its own encrypted Isometric access token and client secret. A Platform Admin must configure them before the organization can read from or submit to the registry.",
  },
  template: {
    requirementLabel: "Removal template resolved",
    whyDetail:
      "The facility's default removal template defines which inputs and transport categories the registry expects. It has to resolve cleanly — every referenced component present — before a removal can be assembled from it.",
  },
  evidence: {
    requirementLabel: "Supporting evidence linked",
    whyDetail:
      "Files attached to the three supported evidence roles are sent to the registry automatically when you submit. Noma then verifies that each one reached its intended Datapoint.",
  },
  durability: {
    requirementLabel: "Sampling & durability eligibility",
    whyDetail:
      "Each production run in the removal needs enough qualifying lab samples, with chemistry inside the method's limits, to meet the durability eligibility rules before its carbon can be claimed. This is the same check the submit step enforces.",
  },
};

/** The plain requirement label for a check key. */
export function requirementLabelFor(key: CertRequirementKey): string {
  return CERT_REQUIREMENT_META[key].requirementLabel;
}
