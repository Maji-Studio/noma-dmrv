/**
 * SecondaryFigure — a second figure read under a primary one: the dry biochar
 * under a wet mass, the dry stock under a wet stock estimate.
 *
 * It is data, so both detail levels show it. One caption line, label first,
 * the value in primary ink (tertiary when it is a missing-value token), and an
 * optional trailing slot for a CERT chip. `DetailField`'s `secondary` and
 * `DerivedHeadline`'s `secondary` both render through it, so the pattern reads
 * the same on read views and in derived blocks.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SecondaryFigure({ label, value, empty = false, trailing }: {
  label: ReactNode;
  value: ReactNode;
  /** The value is a missing-value token. */
  empty?: boolean;
  /** Rendered after the value, such as a CERT chip. */
  trailing?: ReactNode;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-6 body-caption text-[var(--color-text-secondary)]">
      <span>{label}</span>
      <span
        className={cn("tabular-nums", empty ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-primary)]")}
        data-empty={empty || undefined}
      >
        {value}
      </span>
      {trailing}
    </span>
  );
}
