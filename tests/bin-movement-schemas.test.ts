import { describe, expect, it } from "vitest";
import {
  recordLossSchema,
  removeLossSchema,
  recordLossFormSchema,
  recordStockTakeSchema,
  stockTakeFormSchema,
} from "@/schemas/bin-movements";

const baseInput = {
  reason: "Physical stock count",
};
const STORAGE_LOCATION_ID = "00000000-0000-4000-8000-000000000001";
const MOVEMENT_ID = "00000000-0000-4000-8000-000000000002";
const REQUEST_KEY = "lost-mass-correction-form";
const REPLACEMENT_KG = 80;
const REASON_LIMIT = 1000;
const REQUEST_KEY_LIMIT = 200;
const OVER_LIMIT = 1;

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
    occurredAt: "2026-10-15T10:00:00.000Z",
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

it("requires an explicit loss event instant in both schemas", () => {
  const loss = { storageLocationId: STORAGE_LOCATION_ID, lane: "feedstock", reason: "Spillage", lossMassKg: 12, idempotencyKey: "loss-time" };
  for (const schema of [recordLossFormSchema, recordLossSchema]) {
    for (const occurredAt of [undefined, "", "2026-10-15T10:00"]) {
      expect(schema.safeParse({ ...loss, occurredAt }).success).toBe(false);
    }
    expect(schema.safeParse({ ...loss, occurredAt: "2026-10-15T10:00:00.000Z" }).success).toBe(true);
  }
});

describe("Lost mass correction schemas", () => {
  const removal = {
    storageLocationId: STORAGE_LOCATION_ID,
    correctsMovementId: MOVEMENT_ID,
    idempotencyKey: REQUEST_KEY,
    reason: "Corrected scale reading",
  };
  const replacement = {
    ...removal,
    lane: "feedstock",
    occurredAt: "2026-01-01T10:00:00.000Z",
    lossMassKg: REPLACEMENT_KG,
  };

  it("preserves the original movement id on a replacement", () => {
    expect(recordLossSchema.parse(replacement)).toMatchObject(replacement);
  });

  it("continues to accept a new Lost mass entry without a correction id", () => {
    expect(recordLossSchema.safeParse({ ...replacement, correctsMovementId: undefined }).success).toBe(true);
  });

  it.each(["", "not-a-uuid", null])("rejects invalid correction id %j on both commands", (correctsMovementId) => {
    for (const schema of [recordLossSchema, removeLossSchema]) {
      const result = schema.safeParse({ ...replacement, correctsMovementId });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["correctsMovementId"] }),
      ]));
    }
  });

  it("removes an entry without requiring a replacement time, mass, or lane", () => {
    expect(removeLossSchema.parse(removal)).toEqual(removal);
  });

  it.each(["storageLocationId", "correctsMovementId", "idempotencyKey", "reason"] as const)(
    "requires %s for removal", (field) => {
      const result = removeLossSchema.safeParse({ ...removal, [field]: undefined });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: [field] }),
      ]));
    },
  );

  it.each([
    { field: "storageLocationId", value: "not-a-uuid" },
    { field: "reason", value: "   " },
    { field: "reason", value: "x".repeat(REASON_LIMIT + OVER_LIMIT) },
    { field: "idempotencyKey", value: "   " },
    { field: "idempotencyKey", value: "x".repeat(REQUEST_KEY_LIMIT + OVER_LIMIT) },
  ])("rejects invalid $field on removal", ({ field, value }) => {
    const result = removeLossSchema.safeParse({ ...removal, [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: [field] }),
    ]));
  });

  it("trims removal reasons and request keys", () => {
    expect(removeLossSchema.parse({ ...removal, reason: `  ${removal.reason}  `, idempotencyKey: `  ${REQUEST_KEY}  ` }))
      .toEqual(removal);
  });

  it.each([
    { lossMassKg: 0 },
    { lossMassKg: -REPLACEMENT_KG },
    { lossMassKg: undefined },
    { occurredAt: undefined },
    { occurredAt: "2026-01-01T10:00" },
  ])("still validates replacement mass and time: %j", (invalid) => {
    expect(recordLossSchema.safeParse({ ...replacement, ...invalid }).success).toBe(false);
  });
});
