import { expect, it } from "vitest";
import { createEmissionEntrySchema, updateEmissionEntrySchema, replaceEmissionEntrySchema } from "./emission-entries";
it("accepts values without a date on create and update, keeping explicit date validation", () => {
  const create = {
    creditBatchId: crypto.randomUUID(), componentId: "line",
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "1", unit: "kWh" }],
  };
  expect(createEmissionEntrySchema.parse(create)).toEqual(create);
  expect(createEmissionEntrySchema.safeParse({ ...create, occurredOn: "2026-02-30" }).success).toBe(false);
  expect(updateEmissionEntrySchema.parse({ id: crypto.randomUUID(), expectedVersion: 1, values: create.values }).occurredOn).toBeUndefined();
});

it("requires replacement values and a positive integer version, with optional date and note", () => {
  const replace = { id: crypto.randomUUID(), expectedVersion: 1,
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "0", unit: "kWh" }] };
  expect(replaceEmissionEntrySchema.parse(replace)).toEqual(replace);
  expect(replaceEmissionEntrySchema.parse({ ...replace, note: null }).note).toBeNull();
  for (const patch of [{ values: undefined }, { values: [] }, { expectedVersion: 0 }, { expectedVersion: 1.5 },
    { occurredOn: "2026-02-30" }, { values: [{ ...replace.values[0], magnitude: "-1" }] }]) {
    expect(replaceEmissionEntrySchema.safeParse({ ...replace, ...patch }).success).toBe(false);
  }
});
