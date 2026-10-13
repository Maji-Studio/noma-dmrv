import { expect, it } from "vitest";
import { outputStockMovementRepresentationSchema, representOutputStockMovement, type OutputStockMovementRepresentationInput } from "./output-stock-movements";

const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const now = new Date("2026-10-06T12:00:00Z");
const row: OutputStockMovementRepresentationInput = {
  id, storageLocationId: id, kind: "loss", occurredAt: now, wetMassKg: 12.5, moisturePercent: 4,
  dryDeltaKg: "-12.000", balanceBeforeDryKg: "100.000", balanceAfterDryKg: "88.000", reason: "Spilled", correctsMovementId: null,
  correctedByMovementId: null, productionRunIds: [id], biocharProductIds: [], targetBiocharProductId: null, deliveryId: null, createdAt: now,
};

it("reads exact ledger text as numbers and strips ledger internals", () => {
  const data = representOutputStockMovement({ ...row, createdBy: "user_1", inputSnapshot: {}, basisFingerprint: "x", idempotencyKey: "k" } as typeof row);
  expect(data).toMatchObject({ dryDeltaKg: -12, balanceBeforeDryKg: 100, balanceAfterDryKg: 88, occurredAt: now.toISOString() });
  expect(Object.keys(data).sort()).toEqual(Object.keys(outputStockMovementRepresentationSchema.shape).sort());
  for (const field of ["createdBy", "inputSnapshot", "basisFingerprint", "idempotencyKey", "postingSequence"]) expect(data).not.toHaveProperty(field);
});

it("refuses a row without a kind or an instant instead of publishing it", () => {
  expect(() => representOutputStockMovement({ ...row, kind: null })).toThrow();
  expect(() => representOutputStockMovement({ ...row, occurredAt: null })).toThrow();
});
