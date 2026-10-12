import { describe, expect, it } from "vitest";
import { eventInstantSchema } from "@/schemas/event-instant";
import { productionRunInstantSchema } from "@/schemas/production-run-input";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { hasLocalEventInstant, resolveEventInstant } from "./event-times";
import { hasLocalRunInstant, resolveRunInstant } from "./production-run-times";

const PARIS = "Europe/Paris";
// Europe/Paris springs forward on 2026-03-29 (02:00 to 03:00) and falls back on 2026-10-25 (03:00 to 02:00).
const DST_GAP = { date: "2026-03-29", time: "02:30" };
const DST_FOLD = { date: "2026-10-25", time: "02:30" };
const path = ["occurredAt"];

function refusal(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error("Expected a refusal");
}

describe("resolveEventInstant", () => {
  it("keeps offset instants and Dates as given, without reading a zone", () => {
    expect(resolveEventInstant("2026-01-01T12:00:00+02:00", undefined, path).toISOString()).toBe("2026-01-01T10:00:00.000Z");
    const date = new Date("2026-01-01T10:00:00Z");
    expect(resolveEventInstant(date, undefined, path)).toBe(date);
  });

  it.each([[PARIS, "2026-01-01T09:00:00.000Z"], ["Africa/Nairobi", "2026-01-01T07:00:00.000Z"]])("reads a local date and time in the facility zone %s", (zone, expected) => {
    expect(resolveEventInstant({ date: "2026-01-01", time: "10:00" }, zone, path).toISOString()).toBe(expected);
  });

  it.each([["a DST gap", DST_GAP], ["a repeated fall-back time", DST_FOLD]])("refuses %s on the caller's path instead of guessing", (_label, local) => {
    const error = refusal(() => resolveEventInstant(local, PARIS, ["sources", 0, "occurredAt"]));
    expect(error).toMatchObject({ code: "validation_failed", issues: [{ path: ["sources", 0, "occurredAt"], code: "validation_failed" }] });
    expect(error.issues[0].message).toBe(error.message);
  });

  it("treats a missing facility zone for a local time as a programming error, not operator input", () => {
    const resolve = () => resolveEventInstant({ date: "2026-01-01", time: "10:00" }, undefined, path);
    expect(resolve).toThrow("Local event times require the effective facility time zone.");
    expect(resolve).not.toThrow(SafeError);
  });

  it("asks for the facility zone only when a value is local", () => {
    expect(hasLocalEventInstant("2026-01-01T10:00:00Z", new Date(), null, undefined)).toBe(false);
    expect(hasLocalEventInstant("2026-01-01T10:00:00Z", { date: "2026-01-01", time: "10:00" })).toBe(true);
  });
});

describe("run aliases", () => {
  it("publish the same schema object, so run contracts cannot drift", () => {
    expect(productionRunInstantSchema).toBe(eventInstantSchema);
  });

  it("resolve exactly like the event resolver on the run field", () => {
    const local = { date: "2026-01-01", time: "10:00" };
    expect(resolveRunInstant(local, PARIS, "startTime")).toEqual(resolveEventInstant(local, PARIS, ["startTime"]));
    for (const field of ["startTime", "endTime"] as const) {
      const run = refusal(() => resolveRunInstant(DST_GAP, PARIS, field));
      const event = refusal(() => resolveEventInstant(DST_GAP, PARIS, [field]));
      expect({ code: run.code, message: run.message, issues: run.issues }).toEqual({ code: event.code, message: event.message, issues: event.issues });
    }
    expect(hasLocalRunInstant(local)).toBe(true);
    expect(hasLocalRunInstant("2026-01-01T10:00:00Z")).toBe(false);
  });
});
