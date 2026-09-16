/**
 * `expectedUpdatedAt` on the consequential update schemas (issue #768).
 *
 * The field crosses the server-action boundary, so it has to survive both a
 * real `Date` and the ISO string a JSON transport leaves behind, and it has to
 * stay optional: payloads that never loaded a version still save.
 */

import { describe, expect, it } from "vitest";
import { updateApplicationSchema } from "@/schemas/applications";
import {
  updateCustomerLocationSchema,
  updateCustomerSchema,
} from "@/schemas/customers";
import { updateFacilitySchema } from "@/schemas/facilities";
import { updateFeedstockSchema } from "@/schemas/feedstocks";
import { updateProductionRunSchema } from "@/schemas/production-runs";
import { updateStorageLocationSchema } from "@/schemas/storage-locations";
import {
  updateSupplierLocationSchema,
  updateSupplierSchema,
} from "@/schemas/suppliers";

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DELIVERY_ID = "11111111-2222-4333-8444-555555555555";
const UPDATED_AT = new Date("2026-01-01T12:34:56.789Z");

/** Every update schema that gained the field, with a minimal valid payload. */
const schemas = [
  ["facility", updateFacilitySchema, { facilityId: ID }],
  ["feedstock", updateFeedstockSchema, { feedstockId: ID }],
  ["storage bin", updateStorageLocationSchema, { storageLocationId: ID }],
  ["customer", updateCustomerSchema, { customerId: ID }],
  ["customer location", updateCustomerLocationSchema, { locationId: ID }],
  ["supplier", updateSupplierSchema, { supplierId: ID }],
  ["supplier location", updateSupplierLocationSchema, { locationId: ID }],
  [
    "application",
    updateApplicationSchema,
    { applicationId: ID, deliveryId: DELIVERY_ID },
  ],
  ["production run", updateProductionRunSchema, { productionRunId: ID }],
] as const;

describe("expectedUpdatedAt on the update schemas", () => {
  it.each(schemas)("accepts a Date on the %s schema", (_label, schema, base) => {
    const parsed = schema.parse({ ...base, expectedUpdatedAt: UPDATED_AT });
    expect(parsed.expectedUpdatedAt).toEqual(UPDATED_AT);
  });

  it.each(schemas)(
    "coerces an ISO string on the %s schema",
    (_label, schema, base) => {
      const parsed = schema.parse({
        ...base,
        expectedUpdatedAt: UPDATED_AT.toISOString(),
      });
      expect(parsed.expectedUpdatedAt).toEqual(UPDATED_AT);
    },
  );

  it.each(schemas)(
    "stays optional on the %s schema",
    (_label, schema, base) => {
      expect(schema.parse({ ...base }).expectedUpdatedAt).toBeUndefined();
    },
  );

  it.each(schemas)(
    "rejects a value that is not a date on the %s schema",
    (_label, schema, base) => {
      expect(
        schema.safeParse({ ...base, expectedUpdatedAt: "not a date" }).success,
      ).toBe(false);
    },
  );
});
