import { describe, expect, it } from "vitest";
import {
  createDeliverySchema,
  updateDeliverySchema,
} from "@/schemas/deliveries";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";

describe("delivery moisture precision", () => {
  it.each([-1, 101])(
    "rejects out-of-range moisture at the create boundary (%s)",
    (moistureContentPercent) => {
      const result = createDeliverySchema.safeParse({
        code: "DEL-001",
        orderId: UUID_A,
        facilityId: UUID_B,
        deliveryDate: new Date("2026-07-26T00:00:00Z"),
        moistureContentPercent,
      });

      expect(result.success).toBe(false);
    },
  );

  it.each([-1, 101])(
    "rejects out-of-range moisture at the update boundary (%s)",
    (moistureContentPercent) => {
      const result = updateDeliverySchema.safeParse({
        deliveryId: UUID_A,
        moistureContentPercent,
      });

      expect(result.success).toBe(false);
    },
  );
});
