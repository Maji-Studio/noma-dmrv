import { describe, expect, it } from "vitest";
import { recordCreditBatchPreviewSchema, recordCreditBatchesSchema } from "./record-credit-batches";

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

describe("recordCreditBatchPreviewSchema", () => {
  const bin = { storageLocationId: RECORD_ID, facilityId: RECORD_ID, occurredAt: "2026-10-21T08:00:00.000Z" };

  it.each(["delivery", "biochar-product"])("accepts a %s bin with or without a planned draw", kind => {
    expect(recordCreditBatchPreviewSchema.safeParse({ kind, bin, draw: null }).success).toBe(true);
    expect(recordCreditBatchPreviewSchema.safeParse({ kind, bin, draw: { wetMassKg: 50, moisturePercent: 10 } }).success).toBe(true);
  });

  it("refuses a feedstock, which never previews", () => {
    expect(recordCreditBatchPreviewSchema.safeParse({ kind: "feedstock", bin, draw: null }).success).toBe(false);
  });

  it("refuses a draw without mass", () => {
    expect(recordCreditBatchPreviewSchema.safeParse({ kind: "delivery", bin, draw: { wetMassKg: null } }).success).toBe(false);
  });

  it("accepts an application with no amount yet, and refuses a zero amount", () => {
    const application = { kind: "application", deliveryId: RECORD_ID, applicationId: null };
    expect(recordCreditBatchPreviewSchema.safeParse({ ...application, appliedWetMassKg: null }).success).toBe(true);
    expect(recordCreditBatchPreviewSchema.safeParse({ ...application, appliedWetMassKg: 0 }).success).toBe(false);
  });
});
