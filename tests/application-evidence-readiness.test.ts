import { makeTestOrgContext } from "./helpers/test-org";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { listDocumentsForEntityIds } from "@/data-access/documents";
import { buildApplicationEvidenceGaps } from "@/fn/certification/application-evidence-readiness";
import {
  APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE,
  APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES,
  APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
} from "@/lib/certification/application-evidence";
import { TEST_GIS_BOUNDARY } from "./helpers/application-evidence-fixtures";

vi.mock("@/data-access/documents", () => ({
  listDocumentsForEntityIds: vi.fn(),
}));

const USER_ID = "user-1";
const APPLICATION_ID = "app-1";
const APPLICATION_CODE = "APP-1";
const mockedListDocuments = vi.mocked(listDocumentsForEntityIds);

function lineage(
  application: Partial<ChainOfCustodyData["application"]>,
): ChainOfCustodyData {
  return {
    facility: { id: "fac-1", code: "F", name: "Facility" },
    application: {
      id: APPLICATION_ID,
      code: APPLICATION_CODE,
      evidenceMethod: "visual",
      gisBoundary: null,
      ...application,
    } as ChainOfCustodyData["application"],
    delivery: { id: "del-1" } as ChainOfCustodyData["delivery"],
    order: null,
    biocharProduct: null,
    productionRun: null,
    reactor: null,
    feedstocks: [],
    warnings: [],
  };
}

describe("buildApplicationEvidenceGaps", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires all three geotagged visual evidence roles", async () => {
    mockedListDocuments.mockResolvedValue([
      {
        entityId: APPLICATION_ID,
        documentType: "photo",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: { geotagStatus: "missing" },
      } as never,
    ]);

    const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
      lineage({ evidenceMethod: "visual" }),
    ]);

    expect(gaps).toEqual([
      "Application APP-1: geotagged stockpile photo",
      "Application APP-1: geotagged spreading photo",
      "Application APP-1: geotagged incorporation photo",
    ]);
  });

  it("does not let one geotagged visual photo satisfy all roles", async () => {
    mockedListDocuments.mockResolvedValue([
      {
        entityId: APPLICATION_ID,
        documentType: "photo",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: { geotagStatus: "present", evidenceRole: "stockpile" },
      } as never,
    ]);

    const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
      lineage({ evidenceMethod: "visual" }),
    ]);

    expect(gaps).not.toContain("Application APP-1: geotagged stockpile photo");
    expect(gaps).toEqual([
      "Application APP-1: geotagged spreading photo",
      "Application APP-1: geotagged incorporation photo",
    ]);
  });

  it("accepts visual evidence when each role has a geotagged photo", async () => {
    mockedListDocuments.mockResolvedValue([
      {
        entityId: APPLICATION_ID,
        documentType: "photo",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: { geotagStatus: "present", evidenceRole: "stockpile" },
      },
      {
        entityId: APPLICATION_ID,
        documentType: "photo",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: { geotagStatus: "present", evidenceRole: "spreading" },
      },
      {
        entityId: APPLICATION_ID,
        documentType: "photo",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: { geotagStatus: "present", evidenceRole: "incorporation" },
      },
    ] as never);

    const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
      lineage({ evidenceMethod: "visual" }),
    ]);

    expect(gaps).toEqual([]);
  });

  it("flags boundary applications missing a GIS reference", async () => {
    mockedListDocuments.mockResolvedValue([]);

    const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
      lineage({ evidenceMethod: "boundary", gisBoundary: null }),
    ]);

    expect(gaps).toEqual(["Application APP-1: GIS reference"]);
  });

  it("does not require a typed logbook when the GIS reference exists", async () => {
    mockedListDocuments.mockResolvedValue([
      {
        entityId: APPLICATION_ID,
        documentType: "pdf",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: {},
      } as never,
    ]);

    const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
      lineage({
        evidenceMethod: "boundary",
        gisBoundary: TEST_GIS_BOUNDARY,
      }),
    ]);

    expect(gaps).toEqual([]);
  });

  it("accepts typed boundary logbook evidence but still flags a missing GIS reference", async () => {
    mockedListDocuments.mockResolvedValue([
      {
        entityId: APPLICATION_ID,
        documentType: "pdf",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: { logbookEvidenceType: "inventory" },
      } as never,
    ]);

    const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
      lineage({ evidenceMethod: "boundary", gisBoundary: null }),
    ]);

    expect(gaps).toEqual(["Application APP-1: GIS reference"]);
  });

  it("does not turn a pending retained record into a boundary gap", async () => {
    mockedListDocuments.mockResolvedValue([
      {
        entityId: APPLICATION_ID,
        documentType: "weighbridge_ticket",
        uploadStatus: "pending",
        fileUrl: null,
        metadata: {},
      } as never,
    ]);

    const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
      lineage({
        evidenceMethod: "boundary",
        gisBoundary: TEST_GIS_BOUNDARY,
      }),
    ]);

    expect(gaps).toEqual([]);
  });

  it("does not require a logbook when other retained evidence exists", async () => {
    mockedListDocuments.mockResolvedValue([
      {
        entityId: APPLICATION_ID,
        documentType: "photo",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: { geotagStatus: "present", evidenceRole: "stockpile" },
      } as never,
    ]);

    const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
      lineage({
        evidenceMethod: "boundary",
        gisBoundary: TEST_GIS_BOUNDARY,
      }),
    ]);

    expect(gaps).toEqual([]);
  });

  it("treats applications with no evidence method selected as visual", async () => {
    mockedListDocuments.mockResolvedValue([]);

    const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
      lineage({ evidenceMethod: undefined }),
    ]);

    expect(gaps).toEqual([
      "Application APP-1: geotagged stockpile photo",
      "Application APP-1: geotagged spreading photo",
      "Application APP-1: geotagged incorporation photo",
    ]);
  });
});

/**
 * The optional retained-record taxonomy remains stable for upload and Source
 * classification even though those records do not affect readiness.
 */
describe("evidence-gap document-type taxonomy parity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("pins the shared document-type taxonomy", () => {
    expect(APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE).toBe("photo");
    expect(APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES).toEqual([
      "weighbridge_ticket",
      "affidavit",
    ]);
    expect(APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE).toBe("pdf");
  });

  it.each(APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES)(
    "keeps %s optional when the GIS reference exists",
    async (documentType) => {
      mockedListDocuments.mockResolvedValue([
        {
          entityId: APPLICATION_ID,
          documentType,
          uploadStatus: "uploaded",
          fileUrl: null,
          metadata: {},
        } as never,
      ]);

      const gaps = await buildApplicationEvidenceGaps(makeTestOrgContext(USER_ID), [
        lineage({
          evidenceMethod: "boundary",
          gisBoundary: TEST_GIS_BOUNDARY,
        }),
      ]);

      expect(gaps).toEqual([]);
    },
  );
});
