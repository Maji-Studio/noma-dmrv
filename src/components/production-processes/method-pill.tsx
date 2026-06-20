/**
 * MethodPill — the Method A / Method B regime badge for a production process.
 * Shared by the list row and the detail panel so the two never drift.
 */
"use client";

import { Lock, LockOpen } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { SamplingMethod } from "@/lib/certification/sampling-requirements";

export function MethodPill({ method }: { method: SamplingMethod }) {
  const isMethodB = method === "method_b";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-4 border px-8 py-2 body-caption font-medium",
        isMethodB
          ? "bg-[var(--st-run-bg)] text-[var(--st-run)] border-[var(--st-run-border)]"
          : "bg-[var(--st-off-bg)] text-[var(--color-text-secondary)] border-[var(--st-off-border)]",
      )}
    >
      {isMethodB ? (
        <LockOpen size={12} weight="bold" />
      ) : (
        <Lock size={12} weight="bold" />
      )}
      {isMethodB ? "Method B" : "Method A"}
    </span>
  );
}
