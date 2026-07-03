import { describe, expect, it } from "vitest";
import { updateApplicationSchema } from "@/schemas/applications";
import { deliveryFormSchema } from "@/schemas/deliveries";
import {
  MASS_INPUT_MAX_KG,
  MASS_INPUT_MAX_TONNES,
  MASS_MAX_KG_MESSAGE,
  MASS_MAX_TONNES_MESSAGE,
} from "@/schemas/helpers";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// #342 review follow-up: a fat-fingered mass entry must fail Zod with a
// friendly message instead of reaching Postgres as a numeric-field overflow.
describe("mass input caps", () => {
  it("rejects a delivery mass above the shared kg cap", () => {
    const result = deliveryFormSchema.safeParse({
      orderId: UUID,
      deliveryDate: new Date("2026-07-01"),
      deliveredWetMassKg: MASS_INPUT_MAX_KG * 10,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["deliveredWetMassKg"],
            message: MASS_MAX_KG_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("accepts a delivery mass exactly at the cap", () => {
    const result = deliveryFormSchema.safeParse({
      orderId: UUID,
      deliveryDate: new Date("2026-07-01"),
      deliveredWetMassKg: MASS_INPUT_MAX_KG,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a tonne-denominated application mass above the shared cap", () => {
    const result = updateApplicationSchema.safeParse({
      applicationId: UUID,
      biocharAppliedTons: MASS_INPUT_MAX_TONNES + 1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharAppliedTons"],
            message: MASS_MAX_TONNES_MESSAGE,
          }),
        ]),
      );
    }
  });
});
