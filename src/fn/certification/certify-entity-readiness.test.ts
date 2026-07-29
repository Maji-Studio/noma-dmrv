import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { listDocumentsForEntityIds } from "@/data-access/documents";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCertifyEntityReadiness } from "./certify-entity-readiness";

vi.mock("@/data-access/documents", () => ({
  listDocumentsForEntityIds: vi.fn(),
}));

const mockedListDocuments = vi.mocked(listDocumentsForEntityIds);

function boundaryLineage(args: {
  id: string;
  code: string;
  hasGisReference: boolean;
}): ChainOfCustodyData {
  return {
    application: {
      id: args.id,
      code: args.code,
      evidenceMethod: "boundary",
      gisBoundary: args.hasGisReference ? ({} as never) : null,
    },
  } as ChainOfCustodyData;
}

describe("buildCertifyEntityReadiness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedListDocuments.mockResolvedValue([]);
  });

  it("omits boundary logbook evidence from removal submission warnings", async () => {
    const result = await buildCertifyEntityReadiness({
      orgCtx: makeTestOrgContext("user-1"),
      lineages: [
        boundaryLineage({
          id: "app-1",
          code: "AP-26-001",
          hasGisReference: true,
        }),
        boundaryLineage({
          id: "app-2",
          code: "AP-26-002",
          hasGisReference: false,
        }),
      ],
      runs: [],
      batchesWithSamples: [],
      transportLegs: { feedstock: [], biochar: [], sample: [] },
      requiredTransportCategories: [],
    });

    expect(result.warnings).toEqual([
      "Application AP-26-002: GIS reference. This does not block submission.",
    ]);
  });
});
