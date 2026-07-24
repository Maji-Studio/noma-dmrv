"use client";

import { useState } from "react";
import type { PaginationState } from "@tanstack/react-table";
import { DEFAULT_LIST_PAGE_SIZE } from "@/config/list-controls";

const GLOBAL_LIST_SCOPE = "global";

interface ListPaginationState {
  scopeKey: string;
  page: number;
  pageSize: number;
}

/**
 * Keeps one-based list pagination scoped to the active facility (or another
 * route scope) without an effect-driven reset when that scope changes.
 */
export function useListPagination(scopeKey?: string | null) {
  const resolvedScopeKey = scopeKey ?? GLOBAL_LIST_SCOPE;
  const [pagination, setPagination] = useState<ListPaginationState>({
    scopeKey: resolvedScopeKey,
    page: 1,
    pageSize: DEFAULT_LIST_PAGE_SIZE,
  });

  const currentPage =
    pagination.scopeKey === resolvedScopeKey ? pagination.page : 1;
  const pageSize = pagination.pageSize;

  const setCurrentPage = (page: number) => {
    setPagination((current) => ({
      scopeKey: resolvedScopeKey,
      page,
      pageSize: current.pageSize,
    }));
  };

  const setPageSize = (nextPageSize: number) => {
    setPagination({
      scopeKey: resolvedScopeKey,
      page: 1,
      pageSize: nextPageSize,
    });
  };

  const onPaginationChange = (next: PaginationState) => {
    setPagination((current) => ({
      scopeKey: resolvedScopeKey,
      page: next.pageSize === current.pageSize ? next.pageIndex + 1 : 1,
      pageSize: next.pageSize,
    }));
  };

  return {
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
    onPaginationChange,
  };
}
