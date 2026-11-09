import { beforeEach, expect, it, vi } from "vitest";
import { getCreditBatchChainData } from "./chain-of-custody-batch";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("./credit-batch-accounting", () => ({ loadCreditBatchRollups: vi.fn() }));

const ctx = makeTestOrgContext();
const batch = { id: "cb-1", code: "CB-1", status: null, startDate: "2026-01-01", endDate: "2026-03-31", facilityId: "f1" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [batch] }) }) });
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({
    "cb-1": { lineageFacts: { runs: [], applications: [], applicationIds: [], productionRunIds: [], appliedWeightTons: 0 } },
  } as never);
});

it("reads the lineage of one Removal's slice when given a removalId", async () => {
  await getCreditBatchChainData(ctx, "cb-1", { removalId: "rem-a" }).catch(() => undefined);
  expect(loadCreditBatchRollups).toHaveBeenCalledWith(ctx, ["cb-1"], { includeRunForwards: true, removalId: "rem-a" });
});
