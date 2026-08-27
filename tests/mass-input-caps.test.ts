import { describe, expect, it } from "vitest";
import { updateApplicationSchema } from "@/schemas/applications";
import { deliveryFormSchema } from "@/schemas/deliveries";
import { storageLocationQuickAddSchema } from "@/schemas/quick-add";
import {
  storageLocationFormSchema,
  updateStorageLocationSchema,
} from "@/schemas/storage-locations";
import { createTransportLegSchema } from "@/schemas/transport-legs";
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
      moistureContentPercent: 10,
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
      moistureContentPercent: 10,
    });

    expect(result.success).toBe(true);
  });

  it("rejects negative delivery wet mass before the DB check", () => {
    const result = deliveryFormSchema.safeParse({
      orderId: UUID,
      deliveryDate: new Date("2026-07-01"),
      deliveredWetMassKg: -1,
      moistureContentPercent: 10,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["deliveredWetMassKg"],
            message: "Wet mass must be greater than 0",
          }),
        ]),
      );
    }
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

  it("rejects storage capacity above the shared kg cap across form, update, and quick-add schemas", () => {
    const cases = [
      storageLocationFormSchema.safeParse({
        name: "Biochar bin",
        type: "biochar_bin",
        facilityId: UUID,
        capacityKg: MASS_INPUT_MAX_KG + 1,
      }),
      updateStorageLocationSchema.safeParse({
        storageLocationId: UUID,
        capacityKg: MASS_INPUT_MAX_KG + 1,
      }),
      storageLocationQuickAddSchema.safeParse({
        name: "Biochar bin",
        type: "biochar_bin",
        facilityId: UUID,
        capacityKg: MASS_INPUT_MAX_KG + 1,
      }),
    ];

    for (const result of cases) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ["capacityKg"],
              message: MASS_MAX_KG_MESSAGE,
            }),
          ]),
        );
      }
    }
  });

  it("accepts storage capacity exactly at the shared kg cap", () => {
    const result = storageLocationFormSchema.safeParse({
      name: "Biochar bin",
      type: "biochar_bin",
      facilityId: UUID,
      capacityKg: MASS_INPUT_MAX_KG,
    });

    expect(result.success).toBe(true);
  });

  it("rejects transport load mass above the shared kg cap", () => {
    const result = createTransportLegSchema.safeParse({
      entityType: "biochar",
      entityId: UUID,
      distanceKm: 10,
      transportMethodType: "road",
      loadMassKg: MASS_INPUT_MAX_KG + 1,
      calculationMethodType: "distance_based",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["loadMassKg"],
            message: MASS_MAX_KG_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("accepts transport load mass exactly at the shared kg cap", () => {
    const result = createTransportLegSchema.safeParse({
      entityType: "biochar",
      entityId: UUID,
      distanceKm: 10,
      transportMethodType: "road",
      loadMassKg: MASS_INPUT_MAX_KG,
      calculationMethodType: "distance_based",
    });

    expect(result.success).toBe(true);
  });
});
