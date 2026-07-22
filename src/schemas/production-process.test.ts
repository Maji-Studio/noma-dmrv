import { describe, expect, it } from "vitest";
import { setOperationalStartSchema } from "./production-process";

const PROCESS_ID = "11111111-1111-4111-8111-111111111111";

describe("setOperationalStartSchema", () => {
  it("accepts a past calendar day and yields a Date at local midnight", () => {
    const result = setOperationalStartSchema.safeParse({
      processId: PROCESS_ID,
      establishedAt: "2020-03-15",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.establishedAt).toBeInstanceOf(Date);
    // Parsed at LOCAL midnight (not UTC), so the calendar day is preserved.
    expect(result.data.establishedAt.getFullYear()).toBe(2020);
    expect(result.data.establishedAt.getMonth()).toBe(2);
    expect(result.data.establishedAt.getDate()).toBe(15);
  });

  it("rejects a future operational start", () => {
    const result = setOperationalStartSchema.safeParse({
      processId: PROCESS_ID,
      establishedAt: "2999-01-01",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "The operational start can't be in the future.",
    );
  });

  it("rejects a non-uuid process id", () => {
    const result = setOperationalStartSchema.safeParse({
      processId: "not-a-uuid",
      establishedAt: "2020-03-15",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing operational start", () => {
    const result = setOperationalStartSchema.safeParse({
      processId: PROCESS_ID,
      establishedAt: "",
    });

    expect(result.success).toBe(false);
  });
});
