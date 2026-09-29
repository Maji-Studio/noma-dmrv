import { describe, expect, it } from "vitest";
import { deriveOrderFulfillmentStatus } from "./fulfillment";

describe("deriveOrderFulfillmentStatus", () => {
  it("reads no deliveries before any delivery exists", () => {
    expect(deriveOrderFulfillmentStatus(0, 0, 5000)).toBe("no_deliveries");
  });

  it("stays partial while delivered wet mass is short of the request", () => {
    expect(deriveOrderFulfillmentStatus(1, 2000, 5000)).toBe("partial");
    expect(deriveOrderFulfillmentStatus(2, 0, 5000)).toBe("partial");
  });

  it("is fulfilled within the shortfall allowance and above the request", () => {
    expect(deriveOrderFulfillmentStatus(3, 4900, 5000)).toBe("fulfilled");
    expect(deriveOrderFulfillmentStatus(3, 5200, 5000)).toBe("fulfilled");
    expect(deriveOrderFulfillmentStatus(3, 4899, 5000)).toBe("partial");
  });

  it("counts exactly the shortfall boundary as fulfilled on a non-round quantity", () => {
    // 1234.5 * 0.98 = 1209.81 (float drift lands a hair above it without rounding)
    expect(deriveOrderFulfillmentStatus(1, 1209.81, 1234.5)).toBe("fulfilled");
    expect(deriveOrderFulfillmentStatus(1, 1209.809, 1234.5)).toBe("partial");
  });
});
