/**
 * Application evidence-health taxonomy.
 *
 * The active Biochar Protocol v1.1 project binds Agricultural Soils v1.1.
 * Project boundaries belong in the PDD, and retained application-mass records
 * support verification. A typed Application logbook is not a per-Application
 * readiness or Removal-submission requirement. The legacy logbook taxonomy
 * below remains only for existing document metadata and registry Source
 * targets. New Application uploads do not ask operators to classify records
 * with the v1.2-only taxonomy.
 *
 * Authoritative sources (verify before any credit claim):
 * https://registry.isometric.com/protocol/biochar/1.1
 * https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1
 */
import type { GisBoundary } from "@/lib/geojson/types";

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
    "Biochar before application. Show identifiable biochar in bags, piles, or containers at the site.",
  spreading:
    "Active application. Show biochar being spread or mixed into the land by spreader, tractor, or by hand.",
  incorporation:
    "After application. Show biochar fully incorporated into the soil or organic matrix with uniform coverage.",
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
 * Document-type taxonomy behind the evidence-gap rule. The rule no longer gates
 * certification submission. It is evaluated by the shared SQL builder
 * (`src/data-access/application-evidence-sql.ts`), which feeds the informational
 * evidence-health counts on the applications list and the dashboard, and by the
 * JS twin (`src/fn/certification/application-evidence-readiness.ts`), retained
 * as that builder's test oracle. Both read the document types from here so the
 * taxonomy cannot silently drift when evidence rules change again.
 */

/** `documents.entityType` value the evidence rule is scoped to, in both adapters. */
export const APPLICATION_DOCUMENT_ENTITY_TYPE = "application" as const;

/** Visual evidence (§8.5.1) is attested by geotagged photos of this document type. */
export const APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE = "photo" as const;

/**
 * Application-owned files that become Isometric Sources for a Biochar
 * Application. GIS files remain local until an active-boundary document
 * identity exists, while these types are managed as supporting evidence.
 */
export const APPLICATION_ISOMETRIC_SOURCE_DOCUMENT_TYPES = [
  APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
  "pdf",
  "weighbridge_ticket",
  "affidavit",
] as const;

export function isApplicationIsometricSourceDocumentType(
  value: string,
): boolean {
  return APPLICATION_ISOMETRIC_SOURCE_DOCUMENT_TYPES.some(
    (documentType) => documentType === value,
  );
}

export function biocharApplicationIdForSource(
  lineage: { entityType: string; entityId: string },
  documentType: string,
): string | null {
  return lineage.entityType === "application" &&
    isApplicationIsometricSourceDocumentType(documentType)
    ? lineage.entityId
    : null;
}

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

/** Minimal document surface required by the application-evidence rule. */
export interface ApplicationEvidenceDocument {
  documentType: string;
  uploadStatus: string | null;
  fileUrl: string | null;
  metadata: unknown;
}

/** Minimal application surface required by the application-evidence rule. */
export interface ApplicationEvidenceApplication {
  evidenceMethod?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gisBoundary?: GisBoundary | null;
}

export interface ApplicationEvidenceUploadedDocumentPredicate {
  kind: "uploaded-document";
  uploadStatusField: "uploadStatus";
  uploadStatus: "uploaded";
  fileUrlField: "fileUrl";
  fileUrlOperator: "not-null";
}

export type ApplicationEvidenceDocumentMatcher =
  | {
      kind: "geotagged-photo-for-role";
      uploaded: ApplicationEvidenceUploadedDocumentPredicate;
      documentType: typeof APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE;
      geotagStatusMetadataKey: "geotagStatus";
      geotagStatus: "present";
      evidenceRoleMetadataKey: "evidenceRole";
      role: ApplicationVisualEvidenceRole;
    };

export type ApplicationEvidenceGapDescriptor =
  | { kind: "location-reference" }
  | {
      kind: "visual-role";
      role: ApplicationVisualEvidenceRole;
    }
  | { kind: "boundary-reference" };

export type ApplicationEvidenceRequirement =
  | {
      kind: "document";
      matcher: ApplicationEvidenceDocumentMatcher;
      gap: ApplicationEvidenceGapDescriptor;
    }
  | {
      kind: "non-null-application-field";
      field: "gisBoundary";
      gap: ApplicationEvidenceGapDescriptor;
    }
  | {
      kind: "complete-gps-pair";
      fields: readonly ["gpsLatitude", "gpsLongitude"];
      gap: ApplicationEvidenceGapDescriptor;
    };

interface ApplicationEvidenceRuleSpec {
  dispatch: {
    kind: "evidence-method";
    locationValue: "location";
    locationPath: "location";
    boundaryValue: "boundary";
    boundaryPath: "boundary";
    defaultPath: "visual";
  };
  paths: {
    location: readonly ApplicationEvidenceRequirement[];
    visual: readonly ApplicationEvidenceRequirement[];
    boundary: readonly ApplicationEvidenceRequirement[];
  };
}

const UPLOADED_DOCUMENT_PREDICATE = {
  kind: "uploaded-document",
  uploadStatusField: "uploadStatus",
  uploadStatus: "uploaded",
  fileUrlField: "fileUrl",
  fileUrlOperator: "not-null",
} as const satisfies ApplicationEvidenceUploadedDocumentPredicate;

const VISUAL_EVIDENCE_REQUIREMENTS: readonly ApplicationEvidenceRequirement[] =
  APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => ({
    kind: "document",
    matcher: {
      kind: "geotagged-photo-for-role",
      uploaded: UPLOADED_DOCUMENT_PREDICATE,
      documentType: APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
      geotagStatusMetadataKey: "geotagStatus",
      geotagStatus: "present",
      evidenceRoleMetadataKey: "evidenceRole",
      role,
    },
    gap: { kind: "visual-role", role },
  }));

const BOUNDARY_EVIDENCE_REQUIREMENTS = [
  {
    kind: "non-null-application-field",
    field: "gisBoundary",
    gap: { kind: "boundary-reference" },
  },
] as const satisfies readonly ApplicationEvidenceRequirement[];

const LOCATION_EVIDENCE_REQUIREMENTS = [
  {
    kind: "complete-gps-pair",
    fields: ["gpsLatitude", "gpsLongitude"],
    gap: { kind: "location-reference" },
  },
] as const satisfies readonly ApplicationEvidenceRequirement[];

/**
 * Single declarative source of truth for application evidence readiness.
 * Location and boundary are explicit branches; legacy/unknown values default
 * to visual so existing records retain their previous fail-closed behaviour.
 */
export const APPLICATION_EVIDENCE_RULE_SPEC = {
  dispatch: {
    kind: "evidence-method",
    locationValue: "location",
    locationPath: "location",
    boundaryValue: "boundary",
    boundaryPath: "boundary",
    defaultPath: "visual",
  },
  paths: {
    location: LOCATION_EVIDENCE_REQUIREMENTS,
    visual: VISUAL_EVIDENCE_REQUIREMENTS,
    boundary: BOUNDARY_EVIDENCE_REQUIREMENTS,
  },
} as const satisfies ApplicationEvidenceRuleSpec;

function metadataValue(metadata: unknown, key: string): unknown {
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") {
    return undefined;
  }
  return (metadata as Readonly<Record<string, unknown>>)[key];
}

function isUploadedDocument(
  document: ApplicationEvidenceDocument,
  predicate: ApplicationEvidenceUploadedDocumentPredicate,
): boolean {
  return (
    document[predicate.uploadStatusField] === predicate.uploadStatus ||
    (predicate.fileUrlOperator === "not-null" &&
      document[predicate.fileUrlField] !== null)
  );
}

/** Evaluate one declarative document matcher against a structural document. */
export function matchesApplicationEvidenceDocument(
  matcher: ApplicationEvidenceDocumentMatcher,
  document: ApplicationEvidenceDocument,
): boolean {
  switch (matcher.kind) {
    case "geotagged-photo-for-role":
      return (
        isUploadedDocument(document, matcher.uploaded) &&
        document.documentType === matcher.documentType &&
        metadataValue(document.metadata, matcher.geotagStatusMetadataKey) ===
          matcher.geotagStatus &&
        metadataValue(document.metadata, matcher.evidenceRoleMetadataKey) ===
          matcher.role
      );
  }
}

/** Resolve requirements for the selected method; unknown values remain visual. */
export function getApplicationEvidenceRequirements(
  evidenceMethod: string | null | undefined,
): readonly ApplicationEvidenceRequirement[] {
  const { dispatch, paths } = APPLICATION_EVIDENCE_RULE_SPEC;
  if (evidenceMethod === dispatch.locationValue) {
    return paths[dispatch.locationPath];
  }
  if (evidenceMethod === dispatch.boundaryValue) {
    return paths[dispatch.boundaryPath];
  }
  return paths[dispatch.defaultPath];
}

/** Pure evaluator shared by non-SQL consumers and contract tests. */
export function getMissingApplicationEvidenceRequirements(
  application: ApplicationEvidenceApplication,
  documents: readonly ApplicationEvidenceDocument[],
): ApplicationEvidenceRequirement[] {
  return getApplicationEvidenceRequirements(application.evidenceMethod).filter(
    (requirement) => {
      switch (requirement.kind) {
        case "document":
          return !documents.some((document) =>
            matchesApplicationEvidenceDocument(requirement.matcher, document),
          );
        case "non-null-application-field":
          return (
            application[requirement.field] === null ||
            application[requirement.field] === undefined
          );
        case "complete-gps-pair":
          return requirement.fields.some(
            (field) =>
              application[field] === null || application[field] === undefined,
          );
      }
    },
  );
}
