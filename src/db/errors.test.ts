import { describe, expect, it } from "vitest";
import {
  isDatabaseSchemaMismatchError,
  isPgCheckViolation,
  isPgCheckViolationMessage,
  isPgForeignKeyViolation,
  isPgNulCharacterError,
} from "./errors";

describe("isPgNulCharacterError", () => {
  const textError = {
    code: "22021",
    message: 'invalid byte sequence for encoding "UTF8": 0x00',
  };

  it("matches a direct driver error and a Drizzle-style cause chain", () => {
    expect(isPgNulCharacterError(textError)).toBe(true);
    const wrapped = new Error("Failed query", { cause: textError });
    expect(isPgNulCharacterError(new Error("Write failed", { cause: wrapped }))).toBe(true);
  });

  it("matches JSONB NUL failures in the driver message or detail", () => {
    expect(isPgNulCharacterError({
      code: "22P05",
      message: "unsupported Unicode escape sequence: \\u0000",
    })).toBe(true);
    expect(isPgNulCharacterError({
      code: "22P05",
      message: "unsupported Unicode escape sequence",
      detail: "\\u0000 cannot be converted to text.",
    })).toBe(true);
  });

  it.each([
    { code: "22021", message: 'invalid byte sequence for encoding "UTF8": 0xff' },
    { code: "22P05", message: "unsupported Unicode escape sequence", detail: "Unicode high surrogate must not follow a high surrogate." },
    { code: "23505", message: "duplicate key value: 0x00" },
    { code: "22021", message: "invalid byte sequence: 0x0001" },
    { code: "22P05", message: "unsupported Unicode escape sequence: \\u0001" },
    { code: "22021", message: null },
    null,
    "0x00",
  ])("rejects unrelated or malformed errors (%j)", (error) => {
    expect(isPgNulCharacterError(error)).toBe(false);
  });

  it("does not combine a wrapper's message with the driver's code", () => {
    expect(isPgNulCharacterError(new Error("Failed query: 0x00", {
      cause: { code: "22021", message: "invalid byte sequence: 0xff" },
    }))).toBe(false);
  });

  it("terminates on cyclic and excessively deep cause chains", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isPgNulCharacterError(cyclic)).toBe(false);

    const wrapperCount = 10;
    let deep: unknown = textError;
    for (let index = 0; index < wrapperCount; index++) deep = { cause: deep };
    expect(isPgNulCharacterError(deep)).toBe(false);
  });
});

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

describe("Postgres foreign-key refusal", () => {
  const constraint = "feedstocks_supplier_id_suppliers_id_fk";

  it("recognizes a named FK refusal directly and through Drizzle", () => {
    const error = { code: "23503", constraint };
    expect(isPgForeignKeyViolation(error, constraint)).toBe(true);
    expect(isPgForeignKeyViolation(new Error("query failed", { cause: error }), constraint)).toBe(true);
  });

  it("does not turn unrelated failures into supplier blocker copy", () => {
    expect(isPgForeignKeyViolation({ code: "23505", constraint }, constraint)).toBe(false);
    expect(isPgForeignKeyViolation({ code: "23503", constraint: "other_fk" }, constraint)).toBe(false);
    expect(isPgForeignKeyViolation(new Error(constraint), constraint)).toBe(false);
  });

  it("terminates on cyclic or malformed causes", () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(isPgForeignKeyViolation(error, constraint)).toBe(false);
    expect(isPgForeignKeyViolation(null, constraint)).toBe(false);
  });
});
