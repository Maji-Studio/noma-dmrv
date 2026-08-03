"use client";

import type { ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

export function DisclosureSummary({
  children,
  className,
  underline = true,
}: {
  children: ReactNode;
  className?: string;
  underline?: boolean;
}) {
  return (
    <summary
      className={cn(
        "flex min-h-44 cursor-pointer items-center gap-6 list-none body-caption text-[var(--color-text-tertiary)] [&::-webkit-details-marker]:hidden hover:text-[var(--color-text-secondary)]",
        className,
      )}
    >
      <CaretDownIcon
        size={16}
        weight="bold"
        className="shrink-0 transition-transform duration-150 group-open:rotate-180"
      />
      <span className={underline ? "underline underline-offset-2" : undefined}>
        {children}
      </span>
    </summary>
  );
}
