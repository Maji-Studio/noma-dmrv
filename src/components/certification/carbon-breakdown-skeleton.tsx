/** Loading skeleton shared by the removal and GHG-statement carbon result surfaces. */
"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/loading-skeleton";

function Shell({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-16 border border-[var(--color-border-primary)] bg-[var(--color-surface-light)] px-16 py-16">
      {children}
    </section>
  );
}

export function CarbonBreakdownSkeleton() {
  return (
    <Shell>
      <div className="flex items-center justify-between">
        <Skeleton width={120} height={12} />
        <Skeleton width={88} height={18} />
      </div>
      <Skeleton width={140} height={30} />
      <Skeleton width="100%" height={10} />
      <div className="flex flex-col gap-10">
        {[64, 56, 72].map((w) => (
          <div key={w} className="flex items-center justify-between">
            <Skeleton width={w + 40} height={12} />
            <Skeleton width={w} height={12} />
          </div>
        ))}
      </div>
    </Shell>
  );
}
