/**
 * Onboarding-shaped loading state. It reserves the setup guide's visual space
 * while status resolves so the operational dashboard never flashes first.
 */
"use client";

import { Skeleton } from "@/components/ui/loading-skeleton";
import { SETUP_STEP_COUNT } from "./onboarding-constants";

export function SetupGuideSkeleton() {
  return (
    <section
      aria-label="Loading getting started"
      aria-busy="true"
      className="flex flex-col gap-24 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] p-24"
    >
      <header className="flex flex-col gap-8">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-24 w-256 max-w-full" />
        <Skeleton className="h-14 w-320 max-w-full" />
      </header>

      <div className="flex flex-col gap-16">
        {Array.from({ length: SETUP_STEP_COUNT }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-16"
            aria-hidden="true"
          >
            <Skeleton className="h-32 w-32 shrink-0 rounded-none" />
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              <Skeleton className="h-16 w-160 max-w-full" />
              <Skeleton className="h-12 w-256 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
