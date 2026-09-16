import { describe, expect, it, vi } from "vitest";

// The hook module pulls in the server action barrel; the mapping under test is
// pure, so stub the actions rather than loading the server layer.
vi.mock("@/fn/bin-movements", () => ({
  getBinMovementsFn: vi.fn(),
  recordLossFn: vi.fn(),
  recordStockTakeFn: vi.fn(),
}));

import {
  RecordLossConflictError,
  RecordLossFieldError,
  throwRecordLossError,
} from "./use-bin-movements";

const conflict = {
  entity: "storageLocation",
  id: "00000000-0000-4000-8000-000000000001",
  code: "",
};

describe("throwRecordLossError", () => {
  it("keeps a field error on its field", () => {
    expect(() =>
      throwRecordLossError({ error: "Not enough stock", field: "lossMassKg" }),
    ).toThrow(RecordLossFieldError);
  });

  it("carries the conflict payload so the form can rotate its key", () => {
    try {
      throwRecordLossError({ error: "Key reused", conflict });
      expect.unreachable("expected a conflict error");
    } catch (error) {
      expect(error).toBeInstanceOf(RecordLossConflictError);
      expect((error as RecordLossConflictError).conflict).toEqual(conflict);
      expect((error as Error).message).toBe("Key reused");
    }
  });

  it("falls back to a plain error", () => {
    expect(() => throwRecordLossError({ error: "Failed to record loss" }))
      .toThrow("Failed to record loss");
  });
});
