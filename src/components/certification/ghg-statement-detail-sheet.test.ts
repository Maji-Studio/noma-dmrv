import { describe, expect, it } from "vitest";
import { hasGhgStatementDetailData } from "./ghg-statement-detail-sheet";

describe("GHG Statement detail loading state", () => {
  it("keeps cached detail data mounted after a background refetch error", () => {
    const refetchError = {
      data: { statementSubmission: null },
      error: new Error("Background refresh failed."),
    };

    expect(hasGhgStatementDetailData(refetchError)).toBe(true);
    expect(hasGhgStatementDetailData({ data: undefined })).toBe(false);
  });
});
