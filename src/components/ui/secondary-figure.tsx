/**
 * SecondaryFigure — a second figure read under a primary one: the dry biochar
 * under a wet mass, the dry stock under a wet stock estimate.
 *
 * It is data, so both detail levels show it. One caption line, value first
 * ("1,500 kg dry biochar"): the number in primary ink, the description quieter
 * and lower-cased. A missing-value token has no number to lead with, so it
 * keeps the label first with the token in tertiary ink. An optional trailing
 * slot holds a CERT chip. `DetailField`'s `secondary` and
 * `DerivedHeadline`'s `secondary` both render through it, so the pattern reads
 * the same on read views and in derived blocks.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function lowerFirst(label: ReactNode): ReactNode {
  return typeof label === "string" && label.length > 0 ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

export function SecondaryFigure({ label, value, empty = false, trailing }: {
  label: ReactNode;
  value: ReactNode;
  /** The value is a missing-value token. */
  empty?: boolean;
  /** Rendered after the value, such as a CERT chip. */
  trailing?: ReactNode;
}) {
  const valueNode = (
    <span
      className={cn("tabular-nums", empty ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-primary)]")}
      data-empty={empty || undefined}
    >
      {value}
    </span>
  );
  const labelNode = <span>{empty ? label : lowerFirst(label)}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-6 body-caption text-[var(--color-text-secondary)]">
      {empty ? <>{labelNode}{valueNode}</> : <>{valueNode}{labelNode}</>}
      {trailing}
    </span>
  );
}
