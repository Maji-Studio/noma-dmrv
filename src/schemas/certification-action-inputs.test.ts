import { describe, expect, it } from "vitest";
import { loadGhgStatementReportsSchema } from "./certification";

const STATEMENT_ID = "22222222-2222-4222-8222-222222222222";

describe("certification action input schemas", () => {
  it("rejects a malformed GHG Statement id", () => {
    expect(
      loadGhgStatementReportsSchema.safeParse({ ghgStatementId: "" }).success,
    ).toBe(false);
  });

  it("accepts a well-formed GHG Statement id", () => {
    expect(
      loadGhgStatementReportsSchema.safeParse({ ghgStatementId: STATEMENT_ID })
        .success,
    ).toBe(true);
  });
});
