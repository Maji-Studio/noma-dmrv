import { expect, it } from "vitest";
import { biocharProductRepresentationSchema, representBiocharProduct, type BiocharProductRepresentationInput } from "./biochar-products";

const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const other = "ea31ace1-5b30-4443-adb4-26b43bfa5599";
const now = new Date("2026-10-06T12:00:00Z");
const row: BiocharProductRepresentationInput = {
  id, code: "BP-26-0001", version: 3, facilityId: id, formulationId: id, status: "testing",
  placedAt: now, productionDate: now, expiresAt: null, sourceBiocharStorageLocationId: id, storageLocationId: other,
  blendMassKg: 130, biocharMoisturePercent: 4, waterAddedKg: 10, densityKgM3: null,
  ingredients: [
    { formulationIngredientId: id, feedstockTypeId: other, storageLocationId: other, wetMassKg: 30, moisturePercent: 20 },
    { formulationIngredientId: other, feedstockTypeId: id, storageLocationId: null, wetMassKg: 0, moisturePercent: null },
  ],
  sourceAllocations: [{ productionRunId: id, wetMassKg: 100, dryMassKg: 96 }],
  archivedAt: null, createdAt: now, updatedAt: now,
};

it("projects ids, saved ingredients and allocations, and derives the biochar mass from the stored blend", () => {
  const data = representBiocharProduct({ ...row, organizationId: "foreign", feedstockTypeName: "private", composition: { ingredients: [] } } as typeof row);
  expect(data).toMatchObject({ biocharWetMassKg: 100, placedAt: now.toISOString(), expiresAt: null, waterAddedKg: 10, densityKgM3: null });
  expect(Object.keys(data).sort()).toEqual(Object.keys(biocharProductRepresentationSchema.shape).sort());
  expect(data).not.toHaveProperty("blendMassKg");
  expect(data.ingredients).toEqual(row.ingredients);
  expect(data.sourceAllocations).toEqual(row.sourceAllocations);
  expect(representBiocharProduct(JSON.parse(JSON.stringify(data)) as never)).toBeDefined();
});

it("keeps ingredient and allocation order, normalizes instants and passes nulls through", () => {
  const data = representBiocharProduct({
    ...row, blendMassKg: null, expiresAt: "2027-10-06T15:00:00+03:00", archivedAt: "2026-10-07T00:00:00Z", ingredients: [...row.ingredients].reverse(),
  });
  expect(data.ingredients.map((ingredient) => ingredient.formulationIngredientId)).toEqual([other, id]);
  expect(data).toMatchObject({ biocharWetMassKg: null, expiresAt: "2027-10-06T12:00:00.000Z", archivedAt: "2026-10-07T00:00:00.000Z" });
});

it("is stable: the same stored facts always give the same bytes", () => {
  expect(JSON.stringify(representBiocharProduct(row))).toBe(JSON.stringify(representBiocharProduct({ ...row })));
});
