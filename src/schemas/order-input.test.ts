import { describe, expect, it } from "vitest";
import { rejectUnknownFields } from "@/lib/api/unknown-fields";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { MASS_INPUT_MAX_KG, MASS_KG_INPUT_STEP, MASS_MIN_KG_MESSAGE } from "./helpers";
import { deleteOrderInput, recordOrderInput, updateOrderApiInput, updateOrderInput } from "./order-input";
import { orderFormSchema, updateOrderSchema } from "./orders";

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const create = { facilityId: ID, customerId: ID, formulationId: ID, orderDate: "2026-10-14", quantityKg: 100.125 };
const target = { orderId: ID, expectedVersion: 1 };
const requiredFields = ["facilityId", "customerId", "formulationId", "orderDate", "quantityKg"];
const unpublished = ["value", "currency", "status", "organizationId", "version", "archivedAt", "deliveredWetMassKg", "remainingWetMassKg", "fulfillmentStatus", "idempotencyKey"];

it.each([
  ["form", orderFormSchema],
  ["action PATCH", updateOrderSchema],
  ["API create", recordOrderInput],
  ["API PATCH", updateOrderApiInput],
  ["operation PATCH", updateOrderInput],
] as const)("uses the shared quantity messages for %s", (_label, schema) => {
  const base = schema === orderFormSchema ? { ...create, packaging: "loose" }
    : schema === recordOrderInput ? create : schema === updateOrderApiInput ? {} : target;
  for (const [quantityKg, message] of [
    ["", "Quantity is required"],
    ["12abc", "Quantity must be a number"],
    [0, "Quantity must be greater than 0"],
    [5e-324, MASS_MIN_KG_MESSAGE],
  ] as const) {
    expect(schema.safeParse({ ...base, quantityKg }).error?.issues).toContainEqual(
      expect.objectContaining({ path: ["quantityKg"], message }),
    );
  }
  expect(schema.parse({ ...base, quantityKg: "12.125" }).quantityKg).toBe(12.125);
});

it.each([recordOrderInput, updateOrderApiInput, updateOrderInput])("requires at least one input step for order quantity", schema => {
  const base = schema === recordOrderInput ? create : schema === updateOrderInput ? target : {};
  for (const quantityKg of [5e-324, 0.0009]) {
    expect(schema.safeParse({ ...base, quantityKg }).error?.issues).toContainEqual(
      expect.objectContaining({ path: ["quantityKg"], message: MASS_MIN_KG_MESSAGE }),
    );
  }
  expect(schema.parse({ ...base, quantityKg: MASS_KG_INPUT_STEP }).quantityKg).toBe(MASS_KG_INPUT_STEP);
});

describe("recordOrderInput", () => {
  it("requires the order facts and leaves packaging for the server to default", () => {
    expect(recordOrderInput.parse(create)).toEqual({ ...create, orderDate: new Date("2026-10-14T00:00:00Z") });
    expect(recordOrderInput.safeParse({}).error?.issues.map(issue => issue.path[0]).sort()).toEqual([...requiredFields].sort());
    expect(recordOrderInput.parse(create)).not.toHaveProperty("packaging");
    expect(recordOrderInput.parse(create)).not.toHaveProperty("customerLocationId");
    expect(recordOrderInput.parse({ ...create, customerLocationId: null }).customerLocationId).toBeNull();
    for (const packaging of ["loose", "bagged"]) expect(recordOrderInput.parse({ ...create, packaging }).packaging).toBe(packaging);
    for (const packaging of [null, "boxed", ""]) expect(recordOrderInput.safeParse({ ...create, packaging }).success).toBe(false);
  });

  it("canonicalizes every reference UUID", () => {
    for (const field of ["facilityId", "customerId", "customerLocationId", "formulationId"]) {
      expect(recordOrderInput.parse({ ...create, [field]: ID.toUpperCase() })).toHaveProperty(field, ID);
      expect(recordOrderInput.safeParse({ ...create, [field]: "not-an-id" }).success, field).toBe(false);
    }
  });

  it("refuses a create code and all unknown or unpublished fields", () => {
    for (const field of ["code", "orderId", "expectedVersion", "mystery", ...unpublished]) {
      expect(recordOrderInput.safeParse({ ...create, [field]: 1 }).success, field).toBe(false);
    }
  });

  it("accepts real calendar days, including future days, and revalidates decoded Dates", () => {
    for (const orderDate of ["2024-02-29", "2099-12-31"]) {
      const parsed = recordOrderInput.parse({ ...create, orderDate });
      expect(parsed.orderDate.toISOString()).toBe(`${orderDate}T00:00:00.000Z`);
      expect(recordOrderInput.parse(parsed).orderDate).toEqual(parsed.orderDate);
    }
    for (const orderDate of ["2026-02-29", "2026-02-31", "2026-13-01", "2026-1-01", "2026-10-14T00:00:00Z", "2026-10-14T00:00:00+02:00", "", null, new Date("2026-10-14T12:00:00Z"), new Date("invalid")]) {
      expect(recordOrderInput.safeParse({ ...create, orderDate }).error?.issues[0].path).toEqual(["orderDate"]);
    }
  });

  it("takes positive wet kg through the shared numeric helper with its cap and precision", () => {
    for (const quantityKg of [0.001, MASS_INPUT_MAX_KG, "12.125"]) expect(recordOrderInput.parse({ ...create, quantityKg }).quantityKg).toBe(Number(quantityKg));
    for (const quantityKg of [0, -1, null, "", "12abc", Number.NaN, Infinity, MASS_INPUT_MAX_KG + 1, 0.0001]) {
      expect(recordOrderInput.safeParse({ ...create, quantityKg }).error?.issues[0].path).toEqual(["quantityKg"]);
    }
  });
});

describe("updateOrderInput", () => {
  it("leaves missing fields absent and decodes individual fields without a stored row", () => {
    expect(updateOrderApiInput.parse({})).toEqual({});
    expect(updateOrderInput.parse(target)).toEqual(target);
    expect(updateOrderApiInput.parse({ quantityKg: "0.001" })).toEqual({ quantityKg: 0.001 });
    expect(updateOrderApiInput.parse({ customerId: ID.toUpperCase() })).toEqual({ customerId: ID });
    expect(updateOrderApiInput.parse({ customerLocationId: null })).toEqual({ customerLocationId: null });
    expect(updateOrderApiInput.parse({ code: "OR-26-002" })).toEqual({ code: "OR-26-002" });
    expect(updateOrderApiInput.parse({ orderDate: "2099-01-01" })).toEqual({ orderDate: new Date("2099-01-01T00:00:00Z") });
  });

  it("clears only the customer location and refuses unknown fields", () => {
    for (const field of ["code", ...requiredFields, "packaging"]) expect(updateOrderApiInput.safeParse({ [field]: null }).success, field).toBe(false);
    for (const field of ["orderId", "expectedVersion", "mystery", ...unpublished]) expect(updateOrderApiInput.safeParse({ [field]: 1 }).success, field).toBe(false);
    for (const code of ["", "or-26-002", "OR 2", "A".repeat(51)]) expect(updateOrderApiInput.safeParse({ code }).success).toBe(false);
    expect(updateOrderApiInput.safeParse({ orderDate: "2026-02-31" }).success).toBe(false);
    expect(updateOrderApiInput.safeParse({ quantityKg: 0 }).success).toBe(false);
    expect(updateOrderApiInput.safeParse({ quantityKg: MASS_INPUT_MAX_KG + 1 }).success).toBe(false);
  });
});

describe("update and delete preconditions", () => {
  it.each([updateOrderInput, deleteOrderInput])("requires a UUID target and positive integer version", schema => {
    expect(schema.safeParse({}).error?.issues.map(issue => issue.path[0]).sort()).toEqual(["expectedVersion", "orderId"]);
    expect(schema.parse({ ...target, orderId: ID.toUpperCase() })).toEqual(target);
    for (const expectedVersion of [undefined, null, 0, -1, 1.5, "1"]) expect(schema.safeParse({ ...target, expectedVersion }).success).toBe(false);
    expect(schema.safeParse({ ...target, mystery: true }).success).toBe(false);
  });

  it("accepts only the target and version in the delete operation input", () => {
    expect(deleteOrderInput.safeParse({ ...target, quantityKg: 1 }).success).toBe(false);
  });
});

it("publishes strict objects, descriptions, date and UUID formats, numeric bounds and no packaging default", () => {
  const contract = toOperationJsonSchema(recordOrderInput);
  const properties = contract.properties as Record<string, Record<string, unknown>>;
  expect(contract.additionalProperties).toBe(false);
  expect((contract.required as string[]).sort()).toEqual([...requiredFields].sort());
  expect(properties.orderDate).toMatchObject({ type: "string", format: "date" });
  for (const field of ["facilityId", "customerId", "formulationId"]) expect(properties[field]).toMatchObject({ type: "string", format: "uuid" });
  expect(properties.quantityKg).toMatchObject({ type: "number", minimum: MASS_KG_INPUT_STEP, maximum: MASS_INPUT_MAX_KG, multipleOf: MASS_KG_INPUT_STEP });
  expect(properties.quantityKg.description).toContain("wet kg as ordered");
  expect(properties.packaging).toMatchObject({ enum: ["loose", "bagged"] });
  expect(properties.packaging).not.toHaveProperty("default");
  const patchProperties = toOperationJsonSchema(updateOrderApiInput).properties as Record<string, Record<string, unknown>>;
  expect(patchProperties.quantityKg).toMatchObject({ minimum: MASS_KG_INPUT_STEP, multipleOf: MASS_KG_INPUT_STEP });
  expect(patchProperties.packaging.description).toBe("Loose or bagged. Omit to keep the stored packaging.");
  for (const schema of [recordOrderInput, updateOrderApiInput, updateOrderInput, deleteOrderInput]) {
    const json = toOperationJsonSchema(schema);
    expect(json.additionalProperties).toBe(false);
    for (const property of Object.values(json.properties as Record<string, Record<string, unknown>>)) expect(property.description).toEqual(expect.any(String));
  }
  expect(toOperationJsonSchema(updateOrderApiInput).required ?? []).toEqual([]);
  expect(() => rejectUnknownFields({ ...create, value: 1 }, contract)).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ path: ["value"] })] }));
});
