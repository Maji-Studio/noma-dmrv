import { describe, expect, it } from "vitest";
import { updateFeedstockSchema, deleteFeedstockSchema } from "./feedstocks";

const feedstockId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
describe.each([updateFeedstockSchema, deleteFeedstockSchema])("feedstock write precondition", (schema) => {
  it.each([undefined, null, 0, -1, 1.5, "1"])("rejects invalid expectedVersion %s", (expectedVersion) => {
    const parsed = schema.safeParse({ feedstockId, expectedVersion });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({ path: ["expectedVersion"], message: "Reload this record before saving." }),
      ]);
    }
  });
  it("requires a positive integer and retires the timestamp precondition", () => {
    expect(schema.parse({ feedstockId, expectedVersion: 1, expectedUpdatedAt: new Date() })).toEqual({ feedstockId, expectedVersion: 1 });
  });
});
