import { describe, expect, it } from "vitest";
import { updateCreditBatchSchema } from "./credit-batches";

describe("updateCreditBatchSchema sampling immutability", () => {
  it("rejects an attempt to change sampling after creation", () => {
    const result = updateCreditBatchSchema.safeParse({
      creditBatchId: "00000000-0000-0000-0000-000000000101",
      sampling: "unsampled",
    });
    expect(result.success).toBe(false);
  });
});
