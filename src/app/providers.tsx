"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { invalidateRecordLocksAfter } from "@/hooks/record-lock-query-keys";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const client: QueryClient = new QueryClient({
      // Mutation hooks declare which record kinds' locks a write can change
      // (`recordLockMeta`); only those mounted reads refetch, after success,
      // or after any outcome for registry writes.
      mutationCache: new MutationCache({
        onSettled: (data, error, _variables, _context, mutation) => invalidateRecordLocksAfter(client, data, error, mutation),
      }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnWindowFocus: false,
        },
      },
    });
    return client;
  });

  return (
    <NuqsAdapter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </NuqsAdapter>
  );
}
