import { describe, expect, it } from "vitest";
import {
  isDatabaseSchemaMismatchError,
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

describe("isDatabaseSchemaMismatchError", () => {
  it("detects an undefined-column error wrapped by Drizzle", () => {
    const cause = Object.assign(
      new Error("column applications.gis_boundary does not exist"),
      { code: "42703" },
    );

    expect(
      isDatabaseSchemaMismatchError(new Error("Failed query", { cause })),
    ).toBe(true);
  });

  it("detects an undefined-table error nested deeper in the cause chain", () => {
    const driverError = Object.assign(
      new Error('relation "emission_estimates" does not exist'),
      { code: "42P01" },
    );
    const wrapped = new Error("Failed query", { cause: driverError });

    expect(
      isDatabaseSchemaMismatchError(
        new Error("dashboard overview failed", { cause: wrapped }),
      ),
    ).toBe(true);
  });

  it("does not classify ordinary query failures as schema drift", () => {
    const cause = Object.assign(new Error("connection timeout"), {
      code: "ETIMEDOUT",
    });

    expect(
      isDatabaseSchemaMismatchError(new Error("Failed query", { cause })),
    ).toBe(false);
    expect(isDatabaseSchemaMismatchError(new Error("Failed query"))).toBe(false);
  });

  it("does not classify undefined-object or undefined-function codes", () => {
    for (const code of ["42704", "42883"]) {
      const error = Object.assign(new Error("operator does not exist"), {
        code,
      });

      expect(isDatabaseSchemaMismatchError(error)).toBe(false);
    }
  });

  it("terminates on a cyclic cause chain", () => {
    const first: { code: string; cause?: unknown } = { code: "23505" };
    const second = { code: "23505", cause: first };
    first.cause = second;

    expect(isDatabaseSchemaMismatchError(first)).toBe(false);
  });
});
