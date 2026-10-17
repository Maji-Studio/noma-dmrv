import { expect, it } from "vitest";
import { MAX_ENTRY_TEXT_LENGTH } from "./emission-entries";
import {
  setEmissionLineCommentSchema, deleteEmissionLineCommentSchema,
  setEmissionLineCommentActionSchema, deleteEmissionLineCommentActionSchema,
} from "./emission-line-comments";

const id = "00000000-0000-4000-8000-000000000001";
const input = { creditBatchId: id, componentId: "line", body: "  Comment\n  " };

it("trims comments and uses the entry note length limit", () => {
  expect(setEmissionLineCommentSchema.parse(input)).toEqual({ ...input, body: "Comment" });
  expect(setEmissionLineCommentSchema.parse({ ...input, body: "a".repeat(MAX_ENTRY_TEXT_LENGTH) }).body).toHaveLength(MAX_ENTRY_TEXT_LENGTH);
  expect(setEmissionLineCommentSchema.safeParse({ ...input, body: "a".repeat(MAX_ENTRY_TEXT_LENGTH + 1) }).success).toBe(false);
});

it.each([
  { body: "" }, { body: " \n\t " }, { body: null }, { componentId: "" },
  { creditBatchId: "invalid" }, { facilityId: "invalid" },
  { expectedVersion: 0 }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: null },
])("rejects malformed comment input: %j", (patch) => {
  expect(setEmissionLineCommentSchema.safeParse({ ...input, ...patch }).success).toBe(false);
});

it("accepts versions for edits and requires them for deletes", () => {
  expect(setEmissionLineCommentSchema.parse({ ...input, expectedVersion: 2 }).expectedVersion).toBe(2);
  expect(deleteEmissionLineCommentSchema.parse({ id, expectedVersion: 2 })).toEqual({ id, expectedVersion: 2 });
  for (const patch of [{ expectedVersion: undefined }, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { id: "invalid" }]) {
    expect(deleteEmissionLineCommentSchema.safeParse({ id, expectedVersion: 2, ...patch }).success).toBe(false);
  }
});

it("requires facility context at the action boundary and strips untrusted fields", () => {
  expect(setEmissionLineCommentActionSchema.safeParse(input).success).toBe(false);
  expect(deleteEmissionLineCommentActionSchema.safeParse({ id, expectedVersion: 1 }).success).toBe(false);
  expect(setEmissionLineCommentActionSchema.parse({ ...input, facilityId: id, organizationId: "foreign", createdBy: "foreign" }))
    .toEqual({ ...input, body: "Comment", facilityId: id });
});
