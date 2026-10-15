import { describe, expect, it } from "vitest";
import { applicationFormSchema } from "./applications";
import { recordApplicationInput, updateApplicationInput } from "./application-input";
const input = { deliveryId: "11111111-1111-4111-8111-111111111111", applicationDate: "2026-01-02", appliedWetMassKg: 4001, fieldSizeHa: 1, gpsLatitude: 0, gpsLongitude: 0 };
describe("application operation input", () => {
  it("keeps kilograms and decodes a calendar day", () => {
    expect(recordApplicationInput.parse(input)).toMatchObject({ appliedWetMassKg: 4001, applicationDate: new Date("2026-01-02T00:00:00Z") });
    expect(recordApplicationInput.safeParse({ ...input, applicationDate: "2026-02-30" }).success).toBe(false);
  });
  it("rejects sub-gram mass, visual evidence and client codes", () => {
    for (const patch of [{ appliedWetMassKg: 0.0001 }, { appliedWetMassKg: 1.0001 }, { evidenceMethod: "visual" }, { code: "AP-X" }]) expect(recordApplicationInput.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it("requires location coordinates or a boundary", () => {
    expect(recordApplicationInput.safeParse({ ...input, evidenceMethod: "boundary" }).error?.issues[0].path).toEqual(["gisBoundary"]);
    expect(recordApplicationInput.safeParse({ ...input, gpsLongitude: null }).success).toBe(false);
  });
  it("preserves omission and explicit clearing on PATCH", () => {
    const patch = updateApplicationInput.parse({ applicationId: input.deliveryId, expectedVersion: 1, cropType: null });
    expect(patch.cropType).toBeNull();
    expect(patch).not.toHaveProperty("evidenceMethod");
    expect(patch).not.toHaveProperty("gpsLatitude");
  });
});

it("shows sub-gram precision errors on the form mass field", () => {
  const result = applicationFormSchema.safeParse({ ...input, biocharAppliedKg: 1.0001 });
  expect(result.error?.issues).toContainEqual(expect.objectContaining({
    path: ["biocharAppliedKg"], message: "Use at most 3 decimal places",
  }));
});
