import { describe, expect, it } from "vitest";
import { getReconciledListPage } from "./use-list-pagination";

describe("getReconciledListPage", () => {
  it("moves an out-of-range page to the last available page", () => {
    expect(
      getReconciledListPage({
        currentPage: 4,
        totalPages: 3,
        isLoading: false,
      }),
    ).toBe(3);
  });

  it("moves an empty result to page one", () => {
    expect(
      getReconciledListPage({
        currentPage: 2,
        totalPages: 0,
        isLoading: false,
      }),
    ).toBe(1);
  });

  it("preserves the page while the replacement result is loading", () => {
    expect(
      getReconciledListPage({
        currentPage: 4,
        totalPages: 0,
        isLoading: true,
      }),
    ).toBe(4);
  });
});
