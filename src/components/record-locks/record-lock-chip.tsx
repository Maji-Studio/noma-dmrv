import { LinkSimpleIcon, LockSimpleIcon, LockSimpleOpenIcon } from "@phosphor-icons/react/dist/ssr";
import type { RecordLockView } from "@/lib/record-lock-view";
import { RECORD_LOCK_CHIP_CLASSES } from "@/lib/status-state";
import { cn } from "@/lib/utils";
import { RECORD_LOCK_LEVEL_LABELS } from "./record-lock-labels";

const CHIP_ICON_SIZE = 14;
/** StatusBadge's default anatomy; the colours come from RECORD_LOCK_CHIP_CLASSES alone. */
const CHIP_BASE = "inline-flex h-[24px] items-center justify-center gap-4 whitespace-nowrap border px-8 py-4 body-caption-fit font-medium";

/** Open lock, link, closed lock: the icon repeats the level for colour-blind readers. */
function LevelIcon({ level }: { level: RecordLockView["level"] }) {
  const props = { size: CHIP_ICON_SIZE, weight: "bold", "aria-hidden": true, className: "shrink-0" } as const;
  switch (level) {
    case "open": return <LockSimpleOpenIcon {...props} />;
    case "inUse": return <LinkSimpleIcon {...props} />;
    case "sent": return <LockSimpleIcon {...props} />;
  }
}

/**
 * The one Open, In use or Sent chip, for list rows and sheet headers alike.
 * The icon repeats the meaning so the colour never carries it alone.
 */
export function RecordLockChip({ level, className }: { level: RecordLockView["level"]; className?: string }) {
  return (
    <span
      data-record-lock={level}
      className={cn(CHIP_BASE, RECORD_LOCK_CHIP_CLASSES[level], className)}
    >
      <LevelIcon level={level} />
      {RECORD_LOCK_LEVEL_LABELS[level]}
    </span>
  );
}

/** A list cell: the chip once the batched read has answered, nothing before. */
export function RecordLockCell({ lock }: { lock: RecordLockView | undefined }) {
  return lock ? <RecordLockChip level={lock.level} /> : null;
}
