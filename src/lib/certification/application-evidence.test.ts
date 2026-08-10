import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  listDocumentsForEntityIds,
  type DocumentRow,
} from "@/data-access/documents";
import { buildApplicationEvidenceGaps } from "@/fn/certification/application-evidence-readiness";
import {
  APPLICATION_EVIDENCE_FIXTURES,
  NULLISH_EVIDENCE_METHOD_FIXTURES,
  type ApplicationEvidenceFixture,
  type NullishEvidenceMethodFixture,
} from "../../../tests/helpers/application-evidence-fixtures";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import {
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

type ContractFixture = ApplicationEvidenceFixture | NullishEvidenceMethodFixture;

/**
 * The DB-representable matrix is shared with the SQL parity suite
 * (`tests/application-evidence-gap-sql.test.ts`); the nullish-method cases are
 * contract-only — the column is a NOT NULL enum, so only this suite can pin
 * the null/undefined ⇒ visual dispatch.
 */
const CONTRACT_FIXTURES: ContractFixture[] = [
  ...APPLICATION_EVIDENCE_FIXTURES,
  ...NULLISH_EVIDENCE_METHOD_FIXTURES,
];

const mockedListDocuments = vi.mocked(listDocumentsForEntityIds);

function evidenceDocuments(
  fixture: ContractFixture,
): ApplicationEvidenceDocument[] {
  return fixture.docs.map((document) => ({
    documentType: document.documentType,
    uploadStatus: document.pending ? "pending" : "uploaded",
    fileUrl: document.pending ? null : UPLOADED_FILE_URL,
    metadata: document.metadata,
  }));
}

function lineageFor(fixture: ContractFixture): ChainOfCustodyData {
  return {
    facility: { id: "facility", code: "FAC", name: "Facility" },
    application: {
      id: APPLICATION_ID,
      code: APPLICATION_CODE,
      status: "applied",
      applicationDate: new Date("2025-06-15"),
      fieldIdentifier: null,
      evidenceMethod: fixture.evidenceMethod,
      gpsLatitude: fixture.gpsLatitude,
      gpsLongitude: fixture.gpsLongitude,
      gisBoundary: fixture.gisBoundary,
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

  it.each(CONTRACT_FIXTURES)(
    "$key",
    async (fixture) => {
      const documents = evidenceDocuments(fixture);
      const pureGaps = getMissingApplicationEvidenceRequirements(
        {
          evidenceMethod: fixture.evidenceMethod,
          gpsLatitude: fixture.gpsLatitude,
          gpsLongitude: fixture.gpsLongitude,
          gisBoundary: fixture.gisBoundary,
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
