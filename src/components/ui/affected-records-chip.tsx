import { cn } from "@/lib/utils";

interface AffectedRecordsChipProps {
  count: number;
  singular: string;
  plural: string;
  className?: string;
}

/** "N affected <records>" toolbar chip shown while a list is filtered by `?ids=`. */
export function AffectedRecordsChip({
  count,
  singular,
  plural,
  className,
}: AffectedRecordsChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-32 items-center border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] px-10 body-caption font-medium text-[var(--st-wait)]",
        className,
      )}
    >
      {count} affected {count === 1 ? singular : plural}
    </span>
  );
}
