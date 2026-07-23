import { describe, expect, it, vi } from "vitest";
import { loadCreditBatchAccounting } from "@/data-access/credit-batch-accounting";
import { getCreditBatchRemovalId } from "@/data-access/credit-batches";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { loadCertifyContextForCreditBatchForUser } from "@/fn/certification/certify-context-core";
import { makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/data-access/credit-batch-accounting", () => ({
  loadCreditBatchAccounting: vi.fn(),
  loadCreditBatchRollups: vi.fn(),
}));

vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchRemovalId: vi.fn(),
}));

vi.mock("@/data-access/certifier-removals", () => ({
  getCertifierRemovalById: vi.fn(),
  getCreditBatchesByRemovalId: vi.fn(),
  listRemovalsForFacility: vi.fn(),
  listUngroupedCreditBatches: vi.fn(),
}));

describe("credit-batch certification scope races", () => {
  it("re-resolves removal scope when grouping commits between reads", async () => {
    const concurrentRemoval = new Error("grouped scope reached");
    vi.mocked(getCreditBatchRemovalId).mockResolvedValue(null);
    vi.mocked(loadCreditBatchAccounting).mockResolvedValue({
      "batch-1": {
        batch: { removalId: "removal-1" },
        lineageFacts: {},
        co2ePreview: {},
      },
    } as never);
    vi.mocked(getCertifierRemovalById).mockRejectedValue(concurrentRemoval);

    await expect(
      loadCertifyContextForCreditBatchForUser(
        makeTestOrgContext("user-1"),
        "batch-1",
      ),
    ).rejects.toBe(concurrentRemoval);
    expect(getCertifierRemovalById).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String) }),
      "removal-1",
    );
  });
});
