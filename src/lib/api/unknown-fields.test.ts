import { expect, it } from "vitest";
import { z } from "zod";
import { createFeedstockSchema, updateFeedstockSchema } from "@/schemas/feedstocks";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { unknownFieldIssues, rejectUnknownFields } from "./unknown-fields";

it("finds every top-level and nested allocation key without validating values", () => {
  expect(unknownFieldIssues({ extra: true, allocations: [{ storageLocationId: "bad-uuid", allocatedWetMassKg: 0, typo: 1 }, { other: 2 }] },
    toOperationJsonSchema(createFeedstockSchema)).map(({ path, code }) => ({ path, code }))).toEqual([
    { path: ["extra"], code: "unknown_field" },
    { path: ["allocations", 0, "typo"], code: "unknown_field" },
    { path: ["allocations", 1, "other"], code: "unknown_field" },
  ]);
});
it("leaves the runner's stripping contract unchanged", () => {
  const input = { feedstockId: "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b", expectedVersion: 1, extra: "discarded" };
  expect(updateFeedstockSchema.parse(input)).not.toHaveProperty("extra");
  expect(() => rejectUnknownFields(input, toOperationJsonSchema(updateFeedstockSchema))).toThrow(expect.objectContaining({ code: "validation_failed" }));
});
it("visits nullable nested objects and array elements", () => {
  const schema = toOperationJsonSchema(z.object({ nested: z.object({ items: z.array(z.object({ name: z.string() })) }).nullable() }));
  expect(unknownFieldIssues({ nested: { items: [{ name: "ok", "a/b~": true }] } }, schema)[0].path).toEqual(["nested", "items", 0, "a/b~"]);
  expect(unknownFieldIssues({ nested: null }, schema)).toEqual([]);
});
