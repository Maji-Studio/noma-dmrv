import { describe, expect, it, vi } from "vitest";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getCreditBatchActiveScopeRemovalId } from "@/data-access/credit-batches";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { loadCertifyContextForCreditBatchForUser } from "@/fn/certification/certify-context-core";
import { makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/data-access/credit-batch-accounting", () => ({
  loadCreditBatchRollups: vi.fn(),
}));

vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchActiveScopeRemovalId: vi.fn(),
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
    vi.mocked(getCreditBatchActiveScopeRemovalId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("removal-1");
    vi.mocked(loadCreditBatchRollups).mockResolvedValue({
      "batch-1": {} as Awaited<ReturnType<typeof loadCreditBatchRollups>>[string],
    });
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
