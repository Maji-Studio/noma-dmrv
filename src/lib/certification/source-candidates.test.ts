import { expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/data-access/production-source-manifest", () => ({ loadProductionClaimFeedstockScope: vi.fn() }));
vi.mock("@/data-access/credit-batch-accounting", () => ({ loadCreditBatchRollups: vi.fn() }));
vi.mock("@/data-access/credit-batch-samples", () => ({ getSamplesByCreditBatchIds: vi.fn(async () => []) }));
vi.mock("@/data-access/feedstocks", () => ({ getFeedstockCodes: vi.fn() }));
vi.mock("@/data-access/certification", () => ({ getCertifierProjectByFacility: vi.fn(async () => null) }));
vi.mock("@/data-access/certifier-removals", () => ({
  getCertifierRemovalById: vi.fn(async () => ({ facilityId: "facility" })),
  getCreditBatchesByRemovalId: vi.fn(async () => [{ id: "batch" }]),
}));
vi.mock("@/data-access/documents", () => ({ listDocumentsForEntity: vi.fn(), listEmissionEntryDocumentsByIds: vi.fn() }));
vi.mock("@/data-access/certifier-document-uploads", () => ({ listDocumentUploadsForDocuments: vi.fn(async () => []) }));
vi.mock("@/data-access/emission-line-files", () => ({ listEmissionLineFilesForBatches: vi.fn() }));
vi.mock("./emission-entry-source-context", () => ({ loadRemovalSourceContext: vi.fn(async () => undefined) }));

import { loadProductionClaimFeedstockScope } from "@/data-access/production-source-manifest";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getFeedstockCodes } from "@/data-access/feedstocks";
import { listDocumentsForEntity } from "@/data-access/documents";
import { loadCandidateDocumentsForRemovalForUser } from "./source-candidates";

it("labels a failed-only counted intake with its code and fetches only missing codes", async () => {
  const ctx = makeTestOrgContext();
  const failedIntakeId = "11111111-1111-4111-8111-111111111111";
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ batch: {
    batch: { id: "batch", code: "CB-26-001", productionEmissionsClaimedByRemovalId: null },
    lineageFacts: {
      applications: [],
      runs: [{ id: "material-run", feedstocks: [{ id: "material-intake", code: "FS-26-001", ownsTransport: true }] }],
    },
  } } as never);
  vi.mocked(loadProductionClaimFeedstockScope).mockResolvedValue({
    feedstockIds: ["material-intake", failedIntakeId],
  } as never);
  vi.mocked(getFeedstockCodes).mockResolvedValue(new Map([[failedIntakeId, "FS-26-002"]]));
  vi.mocked(listDocumentsForEntity).mockImplementation(async (_ctx, kind, id) =>
    kind === "feedstock" && id === failedIntakeId ? [{
      id: "failed-intake-bill", fileName: "failed-intake.pdf", documentType: "bill_of_lading",
      uploadStatus: "uploaded", fileUrl: null, metadata: {},
    }] as never : []);

  const result = await loadCandidateDocumentsForRemovalForUser(ctx, "removal");

  expect(getFeedstockCodes).toHaveBeenCalledExactlyOnceWith(ctx, [failedIntakeId]);
  expect(result.candidates).toMatchObject([{
    document: { id: "failed-intake-bill" },
    lineageEntity: { entityType: "feedstock", entityId: failedIntakeId, entityLabel: "Feedstock FS-26-002" },
    binding: { nomaRole: "feedstock_bill_of_lading", lineage: { entityLabel: "Feedstock FS-26-002" } },
  }]);
});
