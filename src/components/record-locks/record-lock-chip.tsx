import { LinkSimpleIcon, LockSimpleIcon, LockSimpleOpenIcon } from "@phosphor-icons/react/dist/ssr";
import type { RecordLockView } from "@/lib/record-lock-view";
import { statusBadgeVariants } from "@/components/ui/status-badge";
import { RECORD_LOCK_CHIP_CLASSES } from "@/lib/status-state";
import { cn } from "@/lib/utils";
import { RECORD_LOCK_LEVEL_LABELS } from "./record-lock-labels";

const CHIP_ICON_SIZE = 14;


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
      // StatusBadge's anatomy; the lock colours replace its status colours.
      className={cn(statusBadgeVariants({ size: "default" }), "gap-4", RECORD_LOCK_CHIP_CLASSES[level], className)}
    >
      <LevelIcon level={level} />
      {RECORD_LOCK_LEVEL_LABELS[level]}
    </span>
  );
}

const SENT_MARK_SIZE = "1em";

/**
 * The bare Sent lock icon for list rows, shown before the record code. Text
 * size, the Sent chip's colour, and a name for screen readers and hover. It is
 * not focusable: the code beside it is the row's one control.
 */
export function RecordLockSentMark({ lock, className }: { lock: RecordLockView | undefined; className?: string }) {
  if (lock?.level !== "sent") return null;
  return (
    <span
      role="img"
      aria-label={RECORD_LOCK_LEVEL_LABELS.sent}
      title="Sent to Isometric"
      data-record-lock="sent"
      className={cn("inline-flex shrink-0 text-[var(--st-run)]", className)}
    >
      <LockSimpleIcon size={SENT_MARK_SIZE} weight="bold" aria-hidden />
    </span>
  );
}

/**
 * Overview surfaces (list cells, board tiles, cards) show the chip only once a
 * record is Sent. Nearly every record with data downstream is In use, so Open
 * and In use say nothing there; the sheet header and edit form keep all three.
 */
export function RecordLockOverviewChip({ lock, className }: { lock: RecordLockView | undefined; className?: string }) {
  return lock?.level === "sent" ? <RecordLockChip level="sent" className={className} /> : null;
}
