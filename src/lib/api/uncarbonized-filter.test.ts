import { describe, expect, it } from "vitest";
import { storageLocationListSchema } from "./query-schemas";

describe("storage location uncarbonized filter", () => {
  it("accepts booleans for MCP and boolean strings for REST, including false", () => {
    for (const value of [true, false]) {
      expect(storageLocationListSchema.parse({ uncarbonized: value }).uncarbonized).toBe(value);
      expect(storageLocationListSchema.parse({ uncarbonized: String(value) }).uncarbonized).toBe(value);
    }
    expect(storageLocationListSchema.parse({}).uncarbonized).toBeUndefined();
  });
  it.each(["", "yes", "0", "TRUE", null, 0])("refuses malformed value %s", uncarbonized => {
    expect(storageLocationListSchema.safeParse({ uncarbonized }).success).toBe(false);
  });
});
