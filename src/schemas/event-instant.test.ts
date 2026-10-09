import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { validationFailed } from "@/lib/operations/errors";
import { eventInstantSchema } from "./event-instant";

const path = ["occurredAt"];

describe("event instant schema", () => {
  it.each([
    ["an instant in UTC", "2026-01-01T10:00:00Z"],
    ["an instant with a positive offset", "2026-01-01T12:00:00+02:00"],
    ["a facility-local date and time", { date: "2026-01-01", time: "10:00" }],
    ["a native Date from a validated server action", new Date("2026-01-01T10:00:00Z")],
  ])("accepts %s", (_label, value) => {
    expect(eventInstantSchema.safeParse(value).success).toBe(true);
  });

  it("refuses a date-time without an offset, with the field guidance on the event's path", () => {
    const parsed = z.strictObject({ occurredAt: eventInstantSchema }).safeParse({ occurredAt: "2026-01-01T10:00:00" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(validationFailed(parsed.error)).toMatchObject({ code: "validation_failed", issues: [
      { path, message: "Add an explicit offset (Z or +hh:mm), or send { date, time }." },
    ] });
  });

  it.each([
    ["an impossible calendar date", { date: "2026-02-30", time: "12:00" }],
    ["a time with seconds", { date: "2026-01-01", time: "10:00:00" }],
    ["an unknown local field", { date: "2026-01-01", time: "10:00", zone: "Europe/Paris" }],
    ["a bare date", "2026-01-01"],
  ])("refuses %s", (_label, value) => {
    expect(eventInstantSchema.safeParse(value).success).toBe(false);
  });

  it("publishes exactly the two wire shapes, never a native Date", () => {
    const published = toOperationJsonSchema(z.strictObject({ occurredAt: eventInstantSchema }));
    const time = (published.properties as Record<string, { anyOf: unknown[] }>).occurredAt;
    expect(time.anyOf).toHaveLength(2);
    expect(time.anyOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "string", format: "date-time" }),
      expect.objectContaining({ type: "object", required: ["date", "time"] }),
    ]));
    expect(JSON.stringify(published)).not.toContain('"Date"');
  });
});
