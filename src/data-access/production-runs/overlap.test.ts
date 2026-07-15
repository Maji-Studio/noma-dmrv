import { describe, expect, it } from "vitest";
import {
  isReactorStartUniqueViolation,
  runWindowsConflict,
} from "./overlap";

/**
 * Unit coverage for the half-open interval intersection that backs the
 * same-reactor overlap guard (issue #259). `null` end = an open run reaching
 * +∞. Times here are plain epoch millis; the DB guard mirrors this logic with
 * drizzle comparisons (see overlap.ts for why raw `::timestamp` casts are
 * unsafe against UTC-stored timestamp columns).
 */
describe("runWindowsConflict", () => {
  it("detects two closed windows that overlap", () => {
    // [8,12) vs [10,11) — the second sits inside the first.
    expect(runWindowsConflict({ start: 8, end: 12 }, { start: 10, end: 11 })).toBe(true);
  });

  it("treats touching windows as non-overlapping (half-open)", () => {
    // [8,10) and [10,12) share only the instant 10, which is excluded.
    expect(runWindowsConflict({ start: 8, end: 10 }, { start: 10, end: 12 })).toBe(false);
    expect(runWindowsConflict({ start: 10, end: 12 }, { start: 8, end: 10 })).toBe(false);
  });

  it("detects overlap regardless of which run is the candidate (symmetry)", () => {
    // The regression that shipped: editing the later run into an earlier run's
    // window must be caught from both directions.
    const early = { start: 8, end: 10 };
    const stretched = { start: 8.5, end: 15.5 };
    expect(runWindowsConflict(stretched, early)).toBe(true);
    expect(runWindowsConflict(early, stretched)).toBe(true);
  });

  it("blocks any run that starts at/after an open (NULL-end) run", () => {
    const open = { start: 8, end: null };
    // A later run cannot be recorded until the open run is closed.
    expect(runWindowsConflict({ start: 13, end: 15 }, open)).toBe(true);
    // Two open runs on one reactor always conflict.
    expect(runWindowsConflict({ start: 20, end: null }, open)).toBe(true);
  });

  it("allows backfilling a run that fully precedes an open run", () => {
    const open = { start: 12, end: null };
    // [8,10) ends before the open run starts — no conflict.
    expect(runWindowsConflict({ start: 8, end: 10 }, open)).toBe(false);
  });
});

describe("isReactorStartUniqueViolation", () => {
  it("does not treat a non-23505 error mentioning the index as a uniqueness violation", () => {
    const error = Object.assign(
      new Error("production_runs_reactor_start_unique_idx failed"),
      {
        code: "XX000",
        constraint: "production_runs_reactor_start_unique_idx",
      },
    );

    expect(isReactorStartUniqueViolation(error)).toBe(false);
  });
});
