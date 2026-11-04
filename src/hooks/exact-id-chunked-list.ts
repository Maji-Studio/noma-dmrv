import { useQueries, type QueryFunctionContext, type QueryKey } from "@tanstack/react-query";

interface ExactIdListFilters {
  ids?: string[];
  page?: number;
  pageSize?: number;
}

interface ExactIdListPage<Item> {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Fetch every exact id, or preserve the ordinary paged query when ids are absent. */
export function useExactIdChunkedList<Filters extends ExactIdListFilters, Item>({
  filters,
  chunkSize,
  queryKey,
  fetcher,
  staleTime,
  enabled,
}: {
  filters: Filters | undefined;
  chunkSize: number;
  queryKey: (filters: Filters | undefined) => QueryKey;
  fetcher: (filters: Filters | undefined, context: QueryFunctionContext) => Promise<ExactIdListPage<Item>>;
  staleTime: number;
  enabled?: boolean;
}) {
  const exactIds = filters?.ids ?? [];
  const requests = filters && exactIds.length > 0
    ? Array.from(
        { length: Math.ceil(exactIds.length / chunkSize) },
        (_, index) => {
          const ids = exactIds.slice(index * chunkSize, (index + 1) * chunkSize);
          return { ...filters, ids, page: 1, pageSize: ids.length };
        },
      )
    : [filters];
  const results = useQueries({
    queries: requests.map((request) => ({
      queryKey: queryKey(request),
      queryFn: (context: QueryFunctionContext) => fetcher(request, context),
      staleTime,
      enabled,
    })),
  });

  const items = results.flatMap((result) => result.data?.items ?? []);
  return {
    data: exactIds.length > 0
      ? {
          items,
          total: items.length,
          page: 1,
          pageSize: Math.max(items.length, 1),
          totalPages: items.length > 0 ? 1 : 0,
        }
      : results[0]?.data,
    isLoading: results.some((result) => result.isLoading),
    error: results.find((result) => result.error)?.error ?? null,
  };
}
