"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { invalidateRecordLocks } from "@/hooks/record-lock-query-keys";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const client: QueryClient = new QueryClient({
      // Record locks depend on writes across the whole lineage and on registry
      // refreshes, so every settled mutation refreshes the mounted lock reads.
      mutationCache: new MutationCache({
        onSettled: () => invalidateRecordLocks(client),
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
