// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIST_PAGE_SIZE, STORAGE_BOARD_PAGE_SIZE } from "@/config/list-controls";
import { useListPagination } from "./use-list-pagination";

describe("useListPagination initial page size", () => {
  it("defaults to the shared list size and takes the storage board's larger one", () => {
    expect(renderHook(() => useListPagination("facility")).result.current.pageSize).toBe(DEFAULT_LIST_PAGE_SIZE);
    expect(renderHook(() => useListPagination("facility", STORAGE_BOARD_PAGE_SIZE)).result.current.pageSize).toBe(STORAGE_BOARD_PAGE_SIZE);
  });
});
