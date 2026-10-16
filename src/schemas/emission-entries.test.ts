import { expect, it } from "vitest";
import { createEmissionEntrySchema, updateEmissionEntrySchema, markNothingToRecordSchema, replaceEmissionEntrySchema } from "./emission-entries";
const input = { facilityId: crypto.randomUUID(), creditBatchId: crypto.randomUUID(), componentId: "line", note: "  No lab work.  " };
it("trims an optional note and permits an omitted date without values or files", () => {
  expect(markNothingToRecordSchema.parse(input)).toEqual({ ...input, note: "No lab work." });
});
it.each(["", " \n\t", null])("normalizes blank or null zero note %j to null", note => {
  expect(markNothingToRecordSchema.parse({ ...input, note }).note).toBeNull();
});
it("accepts an omitted note and rejects notes over the text limit", () => {
  const withoutNote = { facilityId: input.facilityId, creditBatchId: input.creditBatchId, componentId: input.componentId };
  expect(markNothingToRecordSchema.parse(withoutNote)).toEqual(withoutNote);
  expect(markNothingToRecordSchema.safeParse({ ...input, note: "a".repeat(4001) }).success).toBe(false);
});
it("rejects malformed dates and missing facility scope", () => {
  expect(markNothingToRecordSchema.safeParse({ ...input, occurredOn: "2026-02-30" }).success).toBe(false);
  expect(markNothingToRecordSchema.safeParse({ ...input, facilityId: undefined }).success).toBe(false);
});

it("accepts values without a date on create and update, keeping explicit date validation", () => {
  const create = {
    creditBatchId: input.creditBatchId, componentId: "line",
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
