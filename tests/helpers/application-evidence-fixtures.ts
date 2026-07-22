/**
 * Shared fixture matrix for the application evidence-gap rule — one case per
 * branch of the Isometric Soil module §8.5.1/§8.5.2 taxonomy. Consumed by BOTH
 * adapter suites so the matrices cannot drift while both stay green:
 *
 *  - `tests/application-evidence-gap-sql.test.ts` seeds these into Postgres and
 *    asserts the compiled SQL (and its parity with the in-memory adapter).
 *  - `src/lib/certification/application-evidence.test.ts` drives the pure
 *    evaluator and the in-memory adapter over the same cases without a DB,
 *    plus the null/undefined-method cases below that the DB cannot represent.
 */
import { APPLICATION_VISUAL_EVIDENCE_ROLES } from "@/lib/certification/application-evidence";

// Expected-gap constants, derived from the taxonomy so a bare integer can never
// drift away from the rule it stands for.
export const NO_GAPS = 0;
export const SINGLE_GAP = 1;
export const ALL_VISUAL_ROLE_GAPS = APPLICATION_VISUAL_EVIDENCE_ROLES.length; // 3
export const ONE_VISUAL_ROLE_SATISFIED_GAPS = ALL_VISUAL_ROLE_GAPS - 1; // 2
export const BOUNDARY_BOTH_INPUT_GAPS = 2; // missing GIS reference + missing logbook

export interface ApplicationEvidenceFixtureDocument {
  documentType: "photo" | "weighbridge_ticket" | "affidavit" | "pdf";
  metadata: Record<string, unknown>;
  /** Pending (not-yet-uploaded) docs must not satisfy any evidence role. */
  pending?: boolean;
}

export interface ApplicationEvidenceFixture {
  key: string;
  evidenceMethod: "visual" | "boundary";
  gisBoundaryReference: string | null;
  docs: ApplicationEvidenceFixtureDocument[];
  expectedGapCount: number;
}

/** One application per DB-representable branch of the evidence rule. */
export const APPLICATION_EVIDENCE_FIXTURES: ApplicationEvidenceFixture[] = [
  // --- Visual method (§8.5.1): all three geotagged roles required ---
  {
    key: "visual-all-roles",
    evidenceMethod: "visual",
    gisBoundaryReference: null,
    docs: APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => ({
      documentType: "photo" as const,
      metadata: { geotagStatus: "present", evidenceRole: role },
    })),
    expectedGapCount: NO_GAPS,
  },
  {
    key: "visual-one-role",
    evidenceMethod: "visual",
    gisBoundaryReference: null,
    docs: [
      {
        documentType: "photo",
        metadata: { geotagStatus: "present", evidenceRole: "stockpile" },
      },
    ],
    expectedGapCount: ONE_VISUAL_ROLE_SATISFIED_GAPS,
  },
  {
    key: "visual-none",
    evidenceMethod: "visual",
    gisBoundaryReference: null,
    docs: [],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  {
    // A photo whose geotag is absent must not satisfy its role.
    key: "visual-geotag-missing",
    evidenceMethod: "visual",
    gisBoundaryReference: null,
    docs: [
      {
        documentType: "photo",
        metadata: { geotagStatus: "missing", evidenceRole: "stockpile" },
      },
    ],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  {
    // A geotagged photo that has not finished uploading must not count.
    key: "visual-pending-upload",
    evidenceMethod: "visual",
    gisBoundaryReference: null,
    docs: [
      {
        documentType: "photo",
        metadata: { geotagStatus: "present", evidenceRole: "stockpile" },
        pending: true,
      },
    ],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  // --- Boundary method (§8.5.2): non-blank GIS reference + a logbook doc ---
  {
    key: "boundary-complete-weighbridge",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-1",
    docs: [{ documentType: "weighbridge_ticket", metadata: {} }],
    expectedGapCount: NO_GAPS,
  },
  {
    key: "boundary-complete-affidavit",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-2",
    docs: [{ documentType: "affidavit", metadata: {} }],
    expectedGapCount: NO_GAPS,
  },
  {
    // Generic PDF counts only when its logbookEvidenceType metadata qualifies.
    key: "boundary-complete-typed-pdf",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-3",
    docs: [{ documentType: "pdf", metadata: { logbookEvidenceType: "inventory" } }],
    expectedGapCount: NO_GAPS,
  },
  {
    // Untyped PDF does not attest logbook quantities.
    key: "boundary-untyped-pdf",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-4",
    docs: [{ documentType: "pdf", metadata: {} }],
    expectedGapCount: SINGLE_GAP,
  },
  {
    // Blank (whitespace) GIS reference is treated as missing even with a logbook.
    key: "boundary-blank-ref",
    evidenceMethod: "boundary",
    gisBoundaryReference: "   ",
    docs: [{ documentType: "affidavit", metadata: {} }],
    expectedGapCount: SINGLE_GAP,
  },
  {
    key: "boundary-ref-no-logbook",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-5",
    docs: [],
    expectedGapCount: SINGLE_GAP,
  },
  {
    key: "boundary-none",
    evidenceMethod: "boundary",
    gisBoundaryReference: null,
    docs: [],
    expectedGapCount: BOUNDARY_BOTH_INPUT_GAPS,
  },
];

export interface NullishEvidenceMethodFixture
  extends Omit<ApplicationEvidenceFixture, "evidenceMethod"> {
  evidenceMethod: null | undefined;
}

/**
 * Null/undefined evidenceMethod follows the visual path (the unified fail-closed
 * semantics). Not DB-representable — the column is a NOT NULL enum — so only the
 * pure/in-memory contract suite runs these.
 */
export const NULLISH_EVIDENCE_METHOD_FIXTURES: NullishEvidenceMethodFixture[] = [
  {
    key: "null-method-defaults-to-visual",
    evidenceMethod: null,
    gisBoundaryReference: null,
    docs: [],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  {
    key: "undefined-method-defaults-to-visual",
    evidenceMethod: undefined,
    gisBoundaryReference: null,
    docs: [],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
];
