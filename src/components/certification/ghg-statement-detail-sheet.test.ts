import { describe, expect, it } from "vitest";
import {
  canUseGhgStatementRegistryActions,
  hasGhgStatementDetailData,
} from "./ghg-statement-detail-sheet";

describe("GHG Statement detail loading state", () => {
  it("keeps cached detail data mounted after a background refetch error", () => {
    const refetchError = {
      data: { statementSubmission: null },
      error: new Error("Background refresh failed."),
    };

    expect(hasGhgStatementDetailData(refetchError)).toBe(true);
    expect(hasGhgStatementDetailData({ data: undefined })).toBe(false);
  });

  it("blocks registry actions while cached details have a refetch error", () => {
    expect(
      canUseGhgStatementRegistryActions({
        error: new Error("Background refresh failed."),
      }),
    ).toBe(false);
    expect(canUseGhgStatementRegistryActions({ error: null })).toBe(true);
  });
});
