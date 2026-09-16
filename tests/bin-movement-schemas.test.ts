import { describe, expect, it } from "vitest";
import {
  recordLossSchema,
  recordStockTakeSchema,
  stockTakeFormSchema,
} from "@/schemas/bin-movements";

const baseInput = {
  reason: "Physical stock count",
};
const STORAGE_LOCATION_ID = "00000000-0000-4000-8000-000000000001";

describe("stock-take form precision", () => {
  it("accepts high-precision feedstock wet mass for canonicalization", () => {
    const result = stockTakeFormSchema.safeParse({
      ...baseInput,
      lane: "feedstock",
      counted: 1.0005,
      moisturePercent: 20,
    });

    expect(result.success).toBe(true);
  });

  it("keeps persisted-scale precision for non-feedstock counts", () => {
    const highPrecision = stockTakeFormSchema.safeParse({
      ...baseInput,
      lane: "product",
      counted: 1.0005,
    });
    const persistedPrecision = stockTakeFormSchema.safeParse({
      ...baseInput,
      lane: "product",
      counted: 1.001,
    });

    expect(highPrecision.success).toBe(false);
    expect(persistedPrecision.success).toBe(true);
  });
});

describe("stock-take validation copy", () => {
  it("describes wet stock and moisture without implementation terms", () => {
    const result = recordStockTakeSchema.safeParse({
      storageLocationId: STORAGE_LOCATION_ID,
      lane: "biochar",
      reason: "Physical stock count",
      countedMassKg: 1,
      countedWetMassKg: 1,
      moistureRatioUsed: 0.1,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(
      "Wet stock and moisture are only valid for feedstock bins",
    );
  });
});

describe("loss request key", () => {
  const loss = {
    storageLocationId: STORAGE_LOCATION_ID,
    lane: "feedstock",
    reason: "Spoiled load",
    lossMassKg: 12,
  };

  it("requires a request key so a resubmitted form replays", () => {
    const missing = recordLossSchema.safeParse(loss);
    const blank = recordLossSchema.safeParse({ ...loss, idempotencyKey: " " });

    expect(missing.success).toBe(false);
    expect(blank.success).toBe(false);
    if (blank.success) return;
    expect(blank.error.issues[0]?.message).toBe(
      "Loss was not saved. Close this form and start a new loss entry.",
    );
  });

  it("accepts a loss carrying its request key", () => {
    const result = recordLossSchema.safeParse({
      ...loss,
      idempotencyKey: "3f6d2c7e-0b5a-4f2f-9c4a-1f0d6d6f1f2a",
    });

    expect(result.success).toBe(true);
  });
});
