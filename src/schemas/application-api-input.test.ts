import { expect, it } from "vitest";
import { recordApplicationApiInput, updateApplicationApiInput } from "./application-api-input";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
const input = { deliveryId: "c98da036-8ad0-43ef-a3da-83d0064d172d", applicationDate: "2025-07-08", appliedWetMassKg: 4001, fieldSizeHa: 3 };
it("accepts raw boundary data without adding server capture facts to the parsed input", () => {
  const gisBoundary = { type: "Polygon", coordinates: [[[37, -3], [38, -3], [38, -2], [37, -3]]] };
  expect(recordApplicationApiInput.parse({ ...input, gisBoundary }).gisBoundary).toEqual(gisBoundary);
  expect(updateApplicationApiInput.parse({ gisBoundary: null })).toEqual({ gisBoundary: null });
});
it("rejects server owned fields and publishes only operation body fields", () => {
  for (const field of ["code", "status", "biocharAppliedTons", "source", "expectedVersion"]) {
    expect(recordApplicationApiInput.safeParse({ ...input, [field]: 1 }).success).toBe(false);
  }
  expect(toOperationJsonSchema(recordApplicationApiInput)).toMatchObject({ additionalProperties: false });
});
