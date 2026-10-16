import { expect, it } from "vitest";
import { markNothingToRecordSchema } from "./emission-entries";
const input = { facilityId: crypto.randomUUID(), creditBatchId: crypto.randomUUID(), componentId: "line", note: "  No lab work.  " };
it("trims the required note and permits an omitted date without values or files", () => {
  expect(markNothingToRecordSchema.parse(input)).toEqual({ ...input, note: "No lab work." });
});
it.each(["", " \n\t"])("rejects blank zero note %j with the operator instruction", note => {
  expect(() => markNothingToRecordSchema.parse({ ...input, note })).toThrow("Enter a note that says why there is nothing to record.");
});
it("rejects malformed dates and missing facility scope", () => {
  expect(markNothingToRecordSchema.safeParse({ ...input, occurredOn: "2026-02-30" }).success).toBe(false);
  expect(markNothingToRecordSchema.safeParse({ ...input, facilityId: undefined }).success).toBe(false);
});
