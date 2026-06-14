import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { listDocumentsForEntityIds } from "@/data-access/documents";
import { buildApplicationEvidenceGaps } from "@/fn/certification/application-evidence-readiness";

vi.mock("@/data-access/documents", () => ({
  listDocumentsForEntityIds: vi.fn(),
}));

const USER_ID = "user-1";
const APPLICATION_ID = "app-1";
const APPLICATION_CODE = "APP-1";
const BOUNDARY_LOGBOOK_GAP =
  "Application APP-1: boundary logbook evidence (Weighbridge, Inventory, Affidavit)";

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
      gisBoundaryReference: null,
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

    const gaps = await buildApplicationEvidenceGaps(USER_ID, [
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

    const gaps = await buildApplicationEvidenceGaps(USER_ID, [
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

    const gaps = await buildApplicationEvidenceGaps(USER_ID, [
      lineage({ evidenceMethod: "visual" }),
    ]);

    expect(gaps).toEqual([]);
  });

  it("flags boundary applications missing boundary reference and logbook", async () => {
    mockedListDocuments.mockResolvedValue([]);

    const gaps = await buildApplicationEvidenceGaps(USER_ID, [
      lineage({ evidenceMethod: "boundary", gisBoundaryReference: null }),
    ]);

    expect(gaps).toEqual([
      "Application APP-1: GIS boundary reference",
      BOUNDARY_LOGBOOK_GAP,
    ]);
  });

  it("does not let an untyped PDF satisfy boundary logbook evidence", async () => {
    mockedListDocuments.mockResolvedValue([
      {
        entityId: APPLICATION_ID,
        documentType: "pdf",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: {},
      } as never,
    ]);

    const gaps = await buildApplicationEvidenceGaps(USER_ID, [
      lineage({
        evidenceMethod: "boundary",
        gisBoundaryReference: "field-boundary-1",
      }),
    ]);

    expect(gaps).toEqual([BOUNDARY_LOGBOOK_GAP]);
  });

  it("accepts typed boundary logbook evidence but still flags a blank boundary reference", async () => {
    mockedListDocuments.mockResolvedValue([
      {
        entityId: APPLICATION_ID,
        documentType: "pdf",
        uploadStatus: "uploaded",
        fileUrl: null,
        metadata: { logbookEvidenceType: "inventory" },
      } as never,
    ]);

    const gaps = await buildApplicationEvidenceGaps(USER_ID, [
      lineage({ evidenceMethod: "boundary", gisBoundaryReference: "   " }),
    ]);

    expect(gaps).toEqual(["Application APP-1: GIS boundary reference"]);
  });
});
