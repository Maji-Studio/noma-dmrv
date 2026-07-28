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
import type { GisBoundary } from "@/lib/geojson/types";

// Expected-gap constants, derived from the taxonomy so a bare integer can never
// drift away from the rule it stands for.
export const NO_GAPS = 0;
export const SINGLE_GAP = 1;
export const ALL_VISUAL_ROLE_GAPS = APPLICATION_VISUAL_EVIDENCE_ROLES.length; // 3
export const ONE_VISUAL_ROLE_SATISFIED_GAPS = ALL_VISUAL_ROLE_GAPS - 1; // 2
export const BOUNDARY_BOTH_INPUT_GAPS = 2; // missing GIS reference + missing logbook

export const TEST_GIS_BOUNDARY: GisBoundary = {
  version: 1,
  source: "paste",
  fileName: null,
  capturedAt: "2026-01-20T00:00:00.000Z",
  collection: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Test field", reference_id: "field-boundary-1" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [37.42, -3.25],
              [37.43, -3.25],
              [37.43, -3.24],
              [37.42, -3.24],
              [37.42, -3.25],
            ],
          ],
        },
      },
    ],
    bbox: [37.42, -3.25, 37.43, -3.24],
  },
  stats: {
    features: 1,
    vertices: 5,
    areaHectares: 123.4,
    bbox: [37.42, -3.25, 37.43, -3.24],
    center: [37.425, -3.245],
  },
  notes: [],
};

export interface ApplicationEvidenceFixtureDocument {
  documentType: "photo" | "weighbridge_ticket" | "affidavit" | "pdf";
  metadata: Record<string, unknown>;
  /** Pending (not-yet-uploaded) docs must not satisfy any evidence role. */
  pending?: boolean;
}

export interface ApplicationEvidenceFixture {
  key: string;
  evidenceMethod: "visual" | "boundary";
  gisBoundary: GisBoundary | null;
  docs: ApplicationEvidenceFixtureDocument[];
  expectedGapCount: number;
}

/** One application per DB-representable branch of the evidence rule. */
export const APPLICATION_EVIDENCE_FIXTURES: ApplicationEvidenceFixture[] = [
  // --- Visual method (§8.5.1): all three geotagged roles required ---
  {
    key: "visual-all-roles",
    evidenceMethod: "visual",
    gisBoundary: null,
    docs: APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => ({
      documentType: "photo" as const,
      metadata: { geotagStatus: "present", evidenceRole: role },
    })),
    expectedGapCount: NO_GAPS,
  },
  {
    key: "visual-one-role",
    evidenceMethod: "visual",
    gisBoundary: null,
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
    gisBoundary: null,
    docs: [],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  {
    // A photo whose geotag is absent must not satisfy its role.
    key: "visual-geotag-missing",
    evidenceMethod: "visual",
    gisBoundary: null,
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
    gisBoundary: null,
    docs: [
      {
        documentType: "photo",
        metadata: { geotagStatus: "present", evidenceRole: "stockpile" },
        pending: true,
      },
    ],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  // --- Boundary method (§8.5.2): GIS reference + a logbook doc ---
  {
    key: "boundary-complete-weighbridge",
    evidenceMethod: "boundary",
    gisBoundary: TEST_GIS_BOUNDARY,
    docs: [{ documentType: "weighbridge_ticket", metadata: {} }],
    expectedGapCount: NO_GAPS,
  },
  {
    key: "boundary-complete-affidavit",
    evidenceMethod: "boundary",
    gisBoundary: TEST_GIS_BOUNDARY,
    docs: [{ documentType: "affidavit", metadata: {} }],
    expectedGapCount: NO_GAPS,
  },
  {
    // Generic PDF counts only when its logbookEvidenceType metadata qualifies.
    key: "boundary-complete-typed-pdf",
    evidenceMethod: "boundary",
    gisBoundary: TEST_GIS_BOUNDARY,
    docs: [{ documentType: "pdf", metadata: { logbookEvidenceType: "inventory" } }],
    expectedGapCount: NO_GAPS,
  },
  {
    // Untyped PDF does not attest logbook quantities.
    key: "boundary-untyped-pdf",
    evidenceMethod: "boundary",
    gisBoundary: TEST_GIS_BOUNDARY,
    docs: [{ documentType: "pdf", metadata: {} }],
    expectedGapCount: SINGLE_GAP,
  },
  {
    // A missing GIS reference is incomplete even with a logbook.
    key: "boundary-missing-reference",
    evidenceMethod: "boundary",
    gisBoundary: null,
    docs: [{ documentType: "affidavit", metadata: {} }],
    expectedGapCount: SINGLE_GAP,
  },
  {
    key: "boundary-ref-no-logbook",
    evidenceMethod: "boundary",
    gisBoundary: TEST_GIS_BOUNDARY,
    docs: [],
    expectedGapCount: SINGLE_GAP,
  },
  {
    key: "boundary-none",
    evidenceMethod: "boundary",
    gisBoundary: null,
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
    gisBoundary: null,
    docs: [],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  {
    key: "undefined-method-defaults-to-visual",
    evidenceMethod: undefined,
    gisBoundary: null,
    docs: [],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
];
