/**
 * Application evidence taxonomy — mirrors the Isometric "Biochar Storage in Soil
 * Environments" module. The module requires ONE of two evidence paths per
 * storage batch:
 *
 *  - Visual (§8.5.1): geotagged photos/videos for ALL THREE application stages —
 *    stockpile (before), spreading (during), incorporation (after). A single
 *    photo is not sufficient; each must carry GPS coordinates and a timestamp.
 *  - Boundary (§8.5.2): a GIS map of the application area plus dated logbook
 *    quantities, evidenced by weighbridge, inventory, or affidavit records.
 *
 * Authoritative source (verify before any credit claim):
 * https://registry.isometric.com/module/biochar-storage-soil-environments
 */
export const APPLICATION_VISUAL_EVIDENCE_ROLES = [
  "stockpile",
  "spreading",
  "incorporation",
] as const;

export type ApplicationVisualEvidenceRole =
  (typeof APPLICATION_VISUAL_EVIDENCE_ROLES)[number];

export const APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS: Record<
  ApplicationVisualEvidenceRole,
  string
> = {
  stockpile: "Stockpile",
  spreading: "Spreading",
  incorporation: "Incorporation",
};

/** What each visual stage photo must show (Isometric Soil module §8.5.1). */
export const APPLICATION_VISUAL_EVIDENCE_ROLE_DESCRIPTIONS: Record<
  ApplicationVisualEvidenceRole,
  string
> = {
  stockpile:
    "Biochar before application — bags, piles, or containers at the site, clearly identifiable as biochar.",
  spreading:
    "The active application — biochar being spread or mixed into the land by spreader, tractor, or by hand.",
  incorporation:
    "After application — biochar fully incorporated into the soil or organic matrix, showing uniform coverage.",
};

export const APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES = [
  "weighbridge",
  "inventory",
  "affidavit",
] as const;

export type ApplicationBoundaryLogbookEvidenceType =
  (typeof APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES)[number];

export const APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS: Record<
  ApplicationBoundaryLogbookEvidenceType,
  string
> = {
  weighbridge: "Weighbridge",
  inventory: "Inventory",
  affidavit: "Affidavit",
};

/** How each logbook document evidences the quantity applied (§8.5.2). */
export const APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_DESCRIPTIONS: Record<
  ApplicationBoundaryLogbookEvidenceType,
  string
> = {
  weighbridge:
    "Weighbridge tickets evidencing the mass of biochar applied to the site.",
  inventory:
    "Inventory-management records showing biochar dispatched to and applied at the site.",
  affidavit:
    "A signed affidavit attesting to the quantity of biochar applied.",
};

export function isApplicationVisualEvidenceRole(
  value: unknown,
): value is ApplicationVisualEvidenceRole {
  return APPLICATION_VISUAL_EVIDENCE_ROLES.includes(
    value as ApplicationVisualEvidenceRole,
  );
}

export function isApplicationBoundaryLogbookEvidenceType(
  value: unknown,
): value is ApplicationBoundaryLogbookEvidenceType {
  return APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES.includes(
    value as ApplicationBoundaryLogbookEvidenceType,
  );
}

/**
 * Document-type taxonomy behind the evidence-gap rule. The rule is implemented
 * twice — once as the certification submission gate (`buildApplicationEvidenceGaps`,
 * `src/fn/certification/application-evidence-readiness.ts`) and once as raw SQL for
 * the dashboard count (`loadGpsGapCounts`, `src/data-access/dashboard-operations.ts`).
 * Both read these document types from here so the taxonomy cannot silently drift
 * between the two implementations when the evidence rules change again.
 */

/** Visual evidence (§8.5.1) is attested by geotagged photos of this document type. */
export const APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE = "photo" as const;

/**
 * Document types that, when uploaded, attest application-boundary logbook
 * quantities (§8.5.2) on their own — a dedicated weighbridge ticket or affidavit.
 */
export const APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES = [
  "weighbridge_ticket",
  "affidavit",
] as const;

/**
 * A generic PDF attests boundary logbook quantities only when its
 * `logbookEvidenceType` metadata is one of
 * {@link APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES}.
 */
export const APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE =
  "pdf" as const;
