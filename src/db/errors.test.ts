import { describe, expect, it } from "vitest";
import {
  isPgCheckViolation,
  isPgCheckViolationMessage,
} from "./errors";

describe("Postgres check-violation predicates", () => {
  it("matches a named check constraint through a wrapped cause", () => {
    const cause = Object.assign(new Error("check failed"), {
      code: "23514",
      constraint: "production_runs_end_after_start",
    });

    expect(
      isPgCheckViolation(
        { cause },
        "production_runs_end_after_start",
      ),
    ).toBe(true);
  });

  it("does not infer a named constraint from message text", () => {
    const error = Object.assign(
      new Error("production_runs_end_after_start failed"),
      { code: "23514" },
    );

    expect(
      isPgCheckViolation(error, "production_runs_end_after_start"),
    ).toBe(false);
  });

  it("matches trigger-raised check violations by explicit message", () => {
    const error = Object.assign(new Error("cannot use Method B: baseline"), {
      code: "23514",
    });

    expect(isPgCheckViolationMessage(error, "cannot use Method B")).toBe(true);
  });
});
