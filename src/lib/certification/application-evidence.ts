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
 * by the certification submission gate (`buildApplicationEvidenceGaps`) and by
 * the shared SQL builder (`src/data-access/application-evidence-sql.ts`) used by
 * list readiness and dashboard counts. Both paths read the document types from
 * here so the taxonomy cannot silently drift when evidence rules change again.
 */

/** `documents.entityType` value the evidence rule is scoped to, in both adapters. */
export const APPLICATION_DOCUMENT_ENTITY_TYPE = "application" as const;

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
  gisBoundaryReference?: string | null;
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
    }
  | {
      kind: "unconditional-logbook-document-type";
      uploaded: ApplicationEvidenceUploadedDocumentPredicate;
      documentTypes: typeof APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES;
    }
  | {
      kind: "conditional-logbook-document-type";
      uploaded: ApplicationEvidenceUploadedDocumentPredicate;
      documentType: typeof APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE;
      evidenceTypeMetadataKey: "logbookEvidenceType";
      evidenceTypes: typeof APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES;
    }
  | {
      kind: "any-document-matcher";
      matchers: readonly ApplicationEvidenceDocumentMatcher[];
    };

export type ApplicationEvidenceGapDescriptor =
  | {
      kind: "visual-role";
      role: ApplicationVisualEvidenceRole;
    }
  | { kind: "boundary-reference" }
  | { kind: "boundary-logbook" };

export type ApplicationEvidenceRequirement =
  | {
      kind: "document";
      matcher: ApplicationEvidenceDocumentMatcher;
      gap: ApplicationEvidenceGapDescriptor;
    }
  | {
      kind: "non-blank-application-field";
      field: "gisBoundaryReference";
      gap: ApplicationEvidenceGapDescriptor;
    };

interface ApplicationEvidenceRuleSpec {
  dispatch: {
    kind: "evidence-method";
    boundaryValue: "boundary";
    boundaryPath: "boundary";
    defaultPath: "visual";
  };
  paths: {
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
    kind: "non-blank-application-field",
    field: "gisBoundaryReference",
    gap: { kind: "boundary-reference" },
  },
  {
    kind: "document",
    matcher: {
      kind: "any-document-matcher",
      matchers: [
        {
          kind: "unconditional-logbook-document-type",
          uploaded: UPLOADED_DOCUMENT_PREDICATE,
          documentTypes:
            APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES,
        },
        {
          kind: "conditional-logbook-document-type",
          uploaded: UPLOADED_DOCUMENT_PREDICATE,
          documentType:
            APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE,
          evidenceTypeMetadataKey: "logbookEvidenceType",
          evidenceTypes: APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES,
        },
      ],
    },
    gap: { kind: "boundary-logbook" },
  },
] as const satisfies readonly ApplicationEvidenceRequirement[];

/**
 * Single declarative source of truth for application evidence readiness.
 * Boundary is the only selected branch; every other value defaults to visual.
 */
export const APPLICATION_EVIDENCE_RULE_SPEC = {
  dispatch: {
    kind: "evidence-method",
    boundaryValue: "boundary",
    boundaryPath: "boundary",
    defaultPath: "visual",
  },
  paths: {
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
    case "unconditional-logbook-document-type":
      return (
        isUploadedDocument(document, matcher.uploaded) &&
        matcher.documentTypes.some((type) => type === document.documentType)
      );
    case "conditional-logbook-document-type":
      return (
        isUploadedDocument(document, matcher.uploaded) &&
        document.documentType === matcher.documentType &&
        matcher.evidenceTypes.some(
          (type) =>
            type ===
            metadataValue(document.metadata, matcher.evidenceTypeMetadataKey),
        )
      );
    case "any-document-matcher":
      return matcher.matchers.some((candidate) =>
        matchesApplicationEvidenceDocument(candidate, document),
      );
  }
}

/** Resolve requirements using boundary-only dispatch; all other values are visual. */
export function getApplicationEvidenceRequirements(
  evidenceMethod: string | null | undefined,
): readonly ApplicationEvidenceRequirement[] {
  const { dispatch, paths } = APPLICATION_EVIDENCE_RULE_SPEC;
  return evidenceMethod === dispatch.boundaryValue
    ? paths[dispatch.boundaryPath]
    : paths[dispatch.defaultPath];
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
        case "non-blank-application-field":
          return (
            (application[requirement.field]?.trim() ?? "").length === 0
          );
      }
    },
  );
}
