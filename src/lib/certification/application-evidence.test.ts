import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  listDocumentsForEntityIds,
  type DocumentRow,
} from "@/data-access/documents";
import { buildApplicationEvidenceGaps } from "@/fn/certification/application-evidence-readiness";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import {
  APPLICATION_VISUAL_EVIDENCE_ROLES,
  getMissingApplicationEvidenceRequirements,
  type ApplicationEvidenceDocument,
} from "./application-evidence";

vi.mock("@/data-access/documents", () => ({
  listDocumentsForEntityIds: vi.fn(),
}));

const TEST_USER_ID = "test-user-application-evidence-contract";
const APPLICATION_ID = "application-evidence-contract";
const APPLICATION_CODE = "AP-EVIDENCE-CONTRACT";
const UPLOADED_FILE_URL = "https://example.test/evidence.jpg";
const NO_GAPS = 0;
const SINGLE_GAP = 1;
const ALL_VISUAL_ROLE_GAPS = APPLICATION_VISUAL_EVIDENCE_ROLES.length;
const ONE_VISUAL_ROLE_SATISFIED_GAPS = ALL_VISUAL_ROLE_GAPS - 1;
const BOUNDARY_BOTH_INPUT_GAPS = 2;

interface FixtureDocument {
  documentType: "photo" | "weighbridge_ticket" | "affidavit" | "pdf";
  metadata: Record<string, unknown>;
  pending?: boolean;
}

interface ApplicationEvidenceFixture {
  key: string;
  evidenceMethod: "visual" | "boundary" | null | undefined;
  gisBoundaryReference: string | null;
  documents: FixtureDocument[];
  expectedGapCount: number;
}

const APPLICATION_EVIDENCE_FIXTURES: ApplicationEvidenceFixture[] = [
  {
    key: "visual-all-roles",
    evidenceMethod: "visual",
    gisBoundaryReference: null,
    documents: APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => ({
      documentType: "photo",
      metadata: { geotagStatus: "present", evidenceRole: role },
    })),
    expectedGapCount: NO_GAPS,
  },
  {
    key: "visual-one-role",
    evidenceMethod: "visual",
    gisBoundaryReference: null,
    documents: [
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
    documents: [],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  {
    key: "visual-geotag-missing",
    evidenceMethod: "visual",
    gisBoundaryReference: null,
    documents: [
      {
        documentType: "photo",
        metadata: { geotagStatus: "missing", evidenceRole: "stockpile" },
      },
    ],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  {
    key: "visual-pending-upload",
    evidenceMethod: "visual",
    gisBoundaryReference: null,
    documents: [
      {
        documentType: "photo",
        metadata: { geotagStatus: "present", evidenceRole: "stockpile" },
        pending: true,
      },
    ],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  {
    key: "boundary-complete-weighbridge",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-1",
    documents: [{ documentType: "weighbridge_ticket", metadata: {} }],
    expectedGapCount: NO_GAPS,
  },
  {
    key: "boundary-complete-affidavit",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-2",
    documents: [{ documentType: "affidavit", metadata: {} }],
    expectedGapCount: NO_GAPS,
  },
  {
    key: "boundary-complete-typed-pdf",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-3",
    documents: [
      {
        documentType: "pdf",
        metadata: { logbookEvidenceType: "inventory" },
      },
    ],
    expectedGapCount: NO_GAPS,
  },
  {
    key: "boundary-untyped-pdf",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-4",
    documents: [{ documentType: "pdf", metadata: {} }],
    expectedGapCount: SINGLE_GAP,
  },
  {
    key: "boundary-blank-ref",
    evidenceMethod: "boundary",
    gisBoundaryReference: "   ",
    documents: [{ documentType: "affidavit", metadata: {} }],
    expectedGapCount: SINGLE_GAP,
  },
  {
    key: "boundary-ref-no-logbook",
    evidenceMethod: "boundary",
    gisBoundaryReference: "field-boundary-5",
    documents: [],
    expectedGapCount: SINGLE_GAP,
  },
  {
    key: "boundary-none",
    evidenceMethod: "boundary",
    gisBoundaryReference: null,
    documents: [],
    expectedGapCount: BOUNDARY_BOTH_INPUT_GAPS,
  },
  {
    key: "null-method-defaults-to-visual",
    evidenceMethod: null,
    gisBoundaryReference: null,
    documents: [],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
  {
    key: "undefined-method-defaults-to-visual",
    evidenceMethod: undefined,
    gisBoundaryReference: null,
    documents: [],
    expectedGapCount: ALL_VISUAL_ROLE_GAPS,
  },
];

const mockedListDocuments = vi.mocked(listDocumentsForEntityIds);

function evidenceDocuments(
  fixture: ApplicationEvidenceFixture,
): ApplicationEvidenceDocument[] {
  return fixture.documents.map((document) => ({
    documentType: document.documentType,
    uploadStatus: document.pending ? "pending" : "uploaded",
    fileUrl: document.pending ? null : UPLOADED_FILE_URL,
    metadata: document.metadata,
  }));
}

function lineageFor(
  fixture: ApplicationEvidenceFixture,
): ChainOfCustodyData {
  return {
    facility: { id: "facility", code: "FAC", name: "Facility" },
    application: {
      id: APPLICATION_ID,
      code: APPLICATION_CODE,
      status: "applied",
      applicationDate: new Date("2025-06-15"),
      fieldIdentifier: null,
      evidenceMethod: fixture.evidenceMethod,
      gisBoundaryReference: fixture.gisBoundaryReference,
      biocharAppliedDryTons: 4.5,
      soilTemperatureC: null,
      href: `/applications/${APPLICATION_ID}`,
    } as ChainOfCustodyData["application"],
    delivery: {
      id: "delivery",
      code: "DL",
      status: null,
      deliveryDate: new Date("2025-06-10"),
      massDryKg: null,
      href: "/deliveries/delivery",
    },
    order: null,
    biocharProduct: null,
    productionRun: null,
    reactor: null,
    feedstocks: [],
    warnings: [],
  };
}

describe("application evidence adapter contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each(APPLICATION_EVIDENCE_FIXTURES)(
    "$key",
    async (fixture) => {
      const documents = evidenceDocuments(fixture);
      const pureGaps = getMissingApplicationEvidenceRequirements(
        {
          evidenceMethod: fixture.evidenceMethod,
          gisBoundaryReference: fixture.gisBoundaryReference,
        },
        documents,
      );
      expect(pureGaps).toHaveLength(fixture.expectedGapCount);

      mockedListDocuments.mockResolvedValue(
        documents.map((document) => ({
          ...document,
          entityId: APPLICATION_ID,
        })) as unknown as DocumentRow[],
      );
      const adapterGaps = await buildApplicationEvidenceGaps(
        makeTestOrgContext(TEST_USER_ID),
        [lineageFor(fixture)],
      );
      expect(adapterGaps).toHaveLength(fixture.expectedGapCount);
      expect(adapterGaps).toHaveLength(pureGaps.length);
    },
  );
});
