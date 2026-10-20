import { describe, expect, it } from "vitest";
import { recordCreditBatchesSchema } from "./record-credit-batches";

const RECORD_ID = "aa989267-fc30-4bcf-a76b-263a6b4ee4ac";

describe("recordCreditBatchesSchema", () => {
  it.each(["feedstock", "biochar-product", "delivery", "application"])("accepts a saved %s and normalizes its UUID", kind => {
    expect(recordCreditBatchesSchema.parse({ kind, id: RECORD_ID.toUpperCase() }))
      .toEqual({ kind, id: RECORD_ID });
  });

  it.each([undefined, null, "", "unsaved"])("refuses an absent or invalid ID: %s", id => {
    expect(recordCreditBatchesSchema.safeParse({ kind: "feedstock", id }).success).toBe(false);
  });

  it("refuses unsupported record kinds", () => {
    expect(recordCreditBatchesSchema.safeParse({ kind: "production-run", id: RECORD_ID }).success).toBe(false);
  });
});
