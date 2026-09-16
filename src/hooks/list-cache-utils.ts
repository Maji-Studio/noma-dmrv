/**
 * Shared React Query cache helpers for the paginated entity list caches.
 *
 * The update hooks save with `expectedUpdatedAt` (issue #768), so any row a
 * cache hands to an edit sheet has to carry a version the server really
 * wrote. An optimistic row therefore keeps the `updatedAt` it was read on, and
 * this helper installs the saved row once the server answers.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Replaces the matching row in every cached list page with the row the server
 * returned, leaving the pagination envelope and every other row untouched.
 * Cheaper than waiting for the refetch that `invalidateQueries` schedules, and
 * it closes the window in which a still-open sheet holds an optimistic
 * version.
 */
export function patchListCachesWithSavedRow<TItem extends { id: string }>(
  queryClient: QueryClient,
  listsKey: QueryKey,
  saved: Partial<TItem> & { id: string },
): void {
  queryClient.setQueriesData<{ items: TItem[] }>(
    { queryKey: listsKey },
    (old) =>
      old
        ? {
            ...old,
            items: old.items.map((item) =>
              item.id === saved.id ? { ...item, ...saved } : item,
            ),
          }
        : old,
  );
}
