import { expect, it } from "vitest";
import { decodeActivityCursor, encodeActivityCursor, activityPageOptionsSchema, DEFAULT_ACTIVITY_PAGE_SIZE, MAX_ACTIVITY_PAGE_SIZE } from "./activity-pagination";

it("round trips millisecond timestamps and sequences larger than safe integers", () => {
  const row = { occurredAt: new Date("2026-10-15T10:00:00.123Z"), sequence: BigInt("9007199254740993") };
  expect(decodeActivityCursor(encodeActivityCursor(row))).toEqual(row);
});
it.each(["", "!", "a", ...[
  {}, { occurredAt: "2026-02-30T00:00:00.000Z", sequence: "1" },
  { occurredAt: "2026-10-15T00:00:00.000Z", sequence: "9223372036854775808" },
  { occurredAt: "2026-10-15T00:00:00.000Z", sequence: "-1" },
  { occurredAt: "2026-10-15T00:00:00.000Z", sequence: "1", extra: true },
].map(value => Buffer.from(JSON.stringify(value)).toString("base64url"))])("rejects malformed cursor %s", cursor => {
  expect(() => decodeActivityCursor(cursor)).toThrow("Invalid activity cursor");
});
it("defaults and bounds the page size", () => {
  expect(activityPageOptionsSchema.parse({}).limit).toBe(DEFAULT_ACTIVITY_PAGE_SIZE);
  for (const limit of [0, -1, 1.5, MAX_ACTIVITY_PAGE_SIZE + 1]) expect(activityPageOptionsSchema.safeParse({ limit }).success).toBe(false);
});
