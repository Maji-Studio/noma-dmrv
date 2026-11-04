// @vitest-environment jsdom
/** The board's lane figures, caption and paging threshold. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_BOARD_PAGE_SIZE } from "@/config/list-controls";
import type { StorageLocationLaneSummary } from "@/data-access/storage-location-lane-summary";

vi.mock("@/hooks/use-record-locks", () => ({ useRecordLocks: () => ({ locks: {} }) }));
vi.mock("./storage-bin-tile", () => ({ StorageBinTile: () => null }));

import { StorageBinBoard, type StorageBinBoardProps } from "./storage-bin-board";

const lanes = (overrides: Partial<StorageLocationLaneSummary> = {}): StorageLocationLaneSummary => ({
  feedstock_bin: { binCount: 12, onHandKg: 458_400, basis: "wet" },
  biochar_bin: { binCount: 1, onHandKg: 1_400, basis: "wet" },
  product_bin: { binCount: 2, onHandKg: 250, basis: "wet" },
  ...overrides,
});

function board(props: Partial<StorageBinBoardProps> = {}) {
  const noop = vi.fn();
  return render(<StorageBinBoard bins={[]} isLoading={false} isStale={false} laneSummary={lanes()} total={0} searchQuery="" onSearchChange={noop}
    typeFilter="all" onTypeFilterChange={noop} sortValue="recent" onSortChange={noop} showArchived={false} onToggleArchived={noop} hasActiveFilters={false}
    onClearFilters={noop} page={1} pageCount={1} pageSize={STORAGE_BOARD_PAGE_SIZE} onPageChange={noop} onPageSizeChange={noop} onCreate={noop} onView={noop}
    onEdit={noop} onArchive={noop} onRestore={noop} onDelete={noop} onReconcile={noop} {...props} />);
}
const rail = () => within(screen.getByRole("navigation", { name: "Filter by bin type" }));
const mobileOptions = () => within(screen.getByLabelText("Filter by bin type", { selector: "select" })).getAllByRole("option").map(option => option.textContent);

afterEach(cleanup);

describe("storage board lane figures", () => {
  it("always names the basis of a non-empty lane, on the rail and in the mobile select", () => {
    board();
    expect(rail().getByText("458.4 t wet mass")).toBeTruthy();
    expect(rail().getByText("250 kg wet mass")).toBeTruthy();
    expect(mobileOptions()).toContain("Product (250 kg wet mass)");
  });

  it("names a lane that fell back to dry biochar, at one decimal like its cards", () => {
    board({ laneSummary: lanes({ biochar_bin: { binCount: 1, onHandKg: 900.5, basis: "dry" } }) });
    expect(rail().getByText("900.5 kg dry biochar")).toBeTruthy();
    expect(mobileOptions()).toContain("Biochar (900.5 kg dry biochar)");
  });

  it("shows a 0.3 kg feedstock lane as 0.3 kg, like its card, not Empty", () => {
    board({ laneSummary: lanes({ feedstock_bin: { binCount: 1, onHandKg: 0.3, basis: "wet" } }) });
    expect(rail().getByText("0.3 kg wet mass")).toBeTruthy();
    expect(mobileOptions()).toContain("Feedstock (0.3 kg wet mass)");
  });

  it("reads a lane whose total renders as zero at its precision as Empty, with no basis", () => {
    board({ laneSummary: lanes({ product_bin: { binCount: 2, onHandKg: 0.3, basis: "wet" }, biochar_bin: { binCount: 1, onHandKg: 0.04, basis: "dry" } }) });
    expect(rail().getAllByText("Empty")).toHaveLength(2);
    expect(rail().queryByText(/250 kg|dry biochar|0\.3 kg/)).toBeNull();
    expect(mobileOptions()).toContain("Product (Empty)");
  });

  it("shows no figure for an archived output lane, which has no stock read", () => {
    board({ laneSummary: lanes({ product_bin: { binCount: 2, onHandKg: null, basis: "wet" } }) });
    expect(mobileOptions()).toContain("Product");
  });
});

describe("storage board paging", () => {
  it("starts at the largest page size so a lane of 12 bins is not split", () => {
    expect(STORAGE_BOARD_PAGE_SIZE).toBe(50);
  });

  it("shows paging controls only for a board bigger than one page", () => {
    board({ total: STORAGE_BOARD_PAGE_SIZE });
    expect(screen.queryByText(/Page 1 of/)).toBeNull();
    cleanup();
    board({ total: STORAGE_BOARD_PAGE_SIZE + 1, pageCount: 2 });
    expect(screen.getByText(/Page 1 of 2/)).toBeTruthy();
  });
});
