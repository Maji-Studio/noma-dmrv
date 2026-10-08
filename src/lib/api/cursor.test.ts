import { expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

const binding = { organizationId: "org-a", resource: "feedstocks", filters: { q: "FS", facilityId: "facility-a" } };
const position = { id: "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b", createdAt: "2026-10-08T10:11:12.123456Z" };
it("round-trips without losing microseconds and canonicalizes filter order", () => {
  const cursor = encodeCursor(position, binding);
  expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(decodeCursor(cursor, { ...binding, filters: { facilityId: "facility-a", q: "FS", code: undefined } })).toEqual(position);
});
it.each([
  { ...binding, organizationId: "org-b" }, { ...binding, resource: "suppliers" },
  { ...binding, filters: {} }, { ...binding, filters: { ...binding.filters, code: "FS-01" } },
])("refuses replay with a different binding", (other) => {
  expect(() => decodeCursor(encodeCursor(position, binding), other)).toThrow(expect.objectContaining({ code: "invalid_cursor", status: 400 }));
});
it.each(["", "not-json", "a=", "a".repeat(4097), Buffer.from('{"v":2}').toString("base64url")])("refuses malformed or obsolete cursors", (cursor) => {
  expect(() => decodeCursor(cursor, binding)).toThrow(expect.objectContaining({ code: "invalid_cursor" }));
});
