import { describe, expect, it, vi } from "vitest";
import { pickCreditBatchRunHoldingAllocation } from "./credit-batch-run-fit";

vi.mock("@/db", () => ({ db: {} }));

const own = { productionRunId: "run-own", creditBatchId: "batch", removalId: "own-holder", removalCode: "RM-1" };
const other = { productionRunId: "run-other", creditBatchId: "other-batch", removalId: "other-holder", removalCode: "RM-2" };

describe("pickCreditBatchRunHoldingAllocation", () => {
  it.each([false, true])("prefers this batch's hold even when another requested run comes first (splits: %s)", splits => {
    expect(pickCreditBatchRunHoldingAllocation([other, own], [other.productionRunId, own.productionRunId], "batch", splits))
      .toEqual(own);
  });

  it.each([false, true])("prefers this batch's hold when the same run has both holders (splits: %s)", splits => {
    const otherForOwnRun = { ...other, productionRunId: own.productionRunId };
    expect(pickCreditBatchRunHoldingAllocation([otherForOwnRun, own], [own.productionRunId], "batch", splits))
      .toEqual(own);
  });

  it("uses another batch's hold when Applications do not split by batch", () => {
    expect(pickCreditBatchRunHoldingAllocation([other, own], [other.productionRunId], "batch", false)).toEqual(other);
  });

  it("allows another batch's hold when Applications split by batch", () => {
    expect(pickCreditBatchRunHoldingAllocation([other, own], [other.productionRunId], "batch", true)).toBeUndefined();
  });

  it("ignores holds for runs outside the requested set", () => {
    expect(pickCreditBatchRunHoldingAllocation([own, other], ["unheld-run"], "batch", false)).toBeUndefined();
    expect(pickCreditBatchRunHoldingAllocation([own, other], [], "batch", false)).toBeUndefined();
    expect(pickCreditBatchRunHoldingAllocation([], [own.productionRunId], "batch", false)).toBeUndefined();
  });
});
