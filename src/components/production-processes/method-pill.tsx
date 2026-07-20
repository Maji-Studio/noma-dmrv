/**
 * MethodPill — the Method A / Method B regime badge for a production process.
 * Shared by the list row and the detail panel so the two never drift.
 */
"use client";

import { LockIcon, LockOpenIcon } from "@phosphor-icons/react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SamplingMethod } from "@/lib/certification/sampling-requirements";

export function MethodPill({ method }: { method: SamplingMethod }) {
  const isMethodB = method === "method_b";
  return (
    <StatusBadge
      status={method}
      icon={
        isMethodB ? (
          <LockOpenIcon size={12} weight="bold" />
        ) : (
          <LockIcon size={12} weight="bold" />
        )
      }
    />
  );
}
