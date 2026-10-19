// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { activeFilterCount, CreditBatchFilters } from "./credit-batch-filters";

afterEach(cleanup);

const handlers = {
  onSearchChange: vi.fn(), onStartDateChange: vi.fn(), onEndDateChange: vi.fn(),
  onReadinessChange: vi.fn(), onAddFeedstock: vi.fn(), onRemoveFeedstock: vi.fn(), onClear: vi.fn(),
};

it("keeps search in view and folds the other filters behind Filters", () => {
  render(<CreditBatchFilters
    search="" startDate="" endDate="" readiness="all"
    feedstocks={[]} selectedFeedstockIds={[]} hasActiveFilters={false}
    {...handlers}
  />);
  const search = screen.getByRole("searchbox", { name: "Search credit batches" });
  expect(search.classList.contains("[&::-webkit-search-cancel-button]:mx-0")).toBe(true);
  expect(search.classList.contains("[&::-webkit-search-cancel-button]:m-0")).toBe(false);
  expect(screen.queryByLabelText("From")).toBeNull();

  const toggle = screen.getByRole("button", { name: "Filters" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");

  for (const label of ["From", "To"]) {
    const input = screen.getByLabelText(label);
    expect(input.getAttribute("type")).toBe("date");
    for (const className of ["px-12", "[display:revert]", "[&::-webkit-calendar-picker-indicator]:ms-8"])
      expect(input.classList.contains(className)).toBe(true);
  }
});

it("counts the active folded filters on the Filters button", () => {
  render(<CreditBatchFilters
    search="CB" startDate="2026-01-01" endDate="" readiness="ready"
    feedstocks={[{ id: "f1", name: "Rice husk" }, { id: "f2", name: "Maize cobs" }]}
    selectedFeedstockIds={["f1", "f2"]} hasActiveFilters
    {...handlers}
  />);
  expect(screen.getByRole("button", { name: /^Filters,\s*3\s*active$/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
  expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
});

it("counts each folded filter once and ignores search", () => {
  expect(activeFilterCount({ startDate: "", endDate: "", selectedFeedstockIds: [], readiness: "all" })).toBe(0);
  expect(activeFilterCount({ startDate: "2026-01-01", endDate: "2026-02-01", selectedFeedstockIds: ["a", "b"], readiness: "needs_attention" })).toBe(4);
});
