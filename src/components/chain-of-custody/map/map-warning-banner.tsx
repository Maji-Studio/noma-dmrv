"use client";

/** The geo payload's warnings, stacked over the Traceability Map. `className` places the stack. */

import { cn } from "@/lib/utils";

export function MapWarningBanner({ warnings, className }: { warnings: string[]; className: string }) {
  if (warnings.length === 0) return null;
  return (
    <div className={cn("absolute z-10 flex max-w-[320px] flex-col gap-10", className)} data-testid="carbon-viewer-warning">
      {warnings.map((warning) => (
        <p
          key={warning}
          className="border-[1.5px] border-dashed border-[var(--clr-red)] bg-[color-mix(in_srgb,var(--color-background-white)_94%,transparent)] px-[14px] py-[11px] text-[9.5px] leading-[1.7] text-[var(--clr-red)] backdrop-blur-[8px]"
        >
          {warning}
        </p>
      ))}
    </div>
  );
}
