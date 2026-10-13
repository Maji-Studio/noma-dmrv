// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreditBatchFilters } from "./credit-batch-filters";

afterEach(cleanup);

it("preserves search-cancel centering and shared date-picker spacing", () => {
  render(<CreditBatchFilters
    search="" startDate="" endDate="" readiness="all"
    feedstocks={[]} selectedFeedstockIds={[]} hasActiveFilters={false}
    onSearchChange={vi.fn()} onStartDateChange={vi.fn()} onEndDateChange={vi.fn()}
    onReadinessChange={vi.fn()} onAddFeedstock={vi.fn()} onRemoveFeedstock={vi.fn()} onClear={vi.fn()}
  />);
  const search = screen.getByRole("searchbox", { name: "Search credit batches" });
  expect(search.classList.contains("[&::-webkit-search-cancel-button]:mx-0")).toBe(true);
  expect(search.classList.contains("[&::-webkit-search-cancel-button]:m-0")).toBe(false);

  for (const label of ["From", "To"]) {
    const input = screen.getByLabelText(label);
    expect(input.getAttribute("type")).toBe("date");
    for (const className of ["px-12", "[display:revert]", "[&::-webkit-calendar-picker-indicator]:ms-8"])
      expect(input.classList.contains(className)).toBe(true);
  }
});
