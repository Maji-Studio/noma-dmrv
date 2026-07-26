import { describe, expect, it } from "vitest";
import { stockTakeFormSchema } from "@/schemas/bin-movements";

const baseInput = {
  reason: "Physical stock count",
};

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
