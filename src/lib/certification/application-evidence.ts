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
