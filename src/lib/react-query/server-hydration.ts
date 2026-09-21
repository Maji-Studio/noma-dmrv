import {
  dehydrate,
  QueryClient,
  type DehydratedState,
  type QueryKey,
} from "@tanstack/react-query";

interface ServerQuerySeed {
  queryKey: QueryKey;
  data: unknown;
}

/**
 * Build request-local hydration state for data already authorized and loaded
 * by a Server Component. A new QueryClient is created for every invocation so
 * cached records can never cross requests or organizations.
 */
export function createServerHydrationState(
  queries: readonly ServerQuerySeed[],
): DehydratedState {
  const queryClient = new QueryClient();
  const loadedAt = Date.now();

  for (const query of queries) {
    queryClient.setQueryData(query.queryKey, query.data, {
      updatedAt: loadedAt,
    });
  }

  return dehydrate(queryClient);
}
