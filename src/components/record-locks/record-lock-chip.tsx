import { LinkSimpleIcon, LockSimpleIcon, LockSimpleOpenIcon } from "@phosphor-icons/react/dist/ssr";
import type { RecordLockView } from "@/lib/record-lock-view";
import { statusBadgeVariants } from "@/components/ui/status-badge";
import { RECORD_LOCK_CHIP_CLASSES, STATUS_STATE_BADGE_CLASSES } from "@/lib/status-state";
import { cn } from "@/lib/utils";
import {
  isInterruptedLockDisplay, RECORD_LOCK_INTERRUPTED_LABEL, RECORD_LOCK_INTERRUPTED_TITLE,
  RECORD_LOCK_LEVEL_LABELS, RECORD_LOCK_SENT_TITLE,
} from "./record-lock-labels";

const CHIP_ICON_SIZE = 14;
/** Interrupted matches the Removal's own red "Submission interrupted" badge. */
const INTERRUPTED_CHIP_CLASSES = STATUS_STATE_BADGE_CLASSES.error;


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
export function RecordLockChip({ level, interrupted = false, className }: {
  level: RecordLockView["level"];
  /** Sent only: sending every holding Removal stopped, so the word changes and the lock does not. */
  interrupted?: boolean;
  className?: string;
}) {
  return (
    <span
      data-record-lock={level}
      // StatusBadge's anatomy; the lock colours replace its status colours.
      className={cn(statusBadgeVariants({ size: "default" }), "gap-4", level === "sent" && interrupted ? INTERRUPTED_CHIP_CLASSES : RECORD_LOCK_CHIP_CLASSES[level], className)}
    >
      <LevelIcon level={level} />
      {level === "sent" && interrupted ? RECORD_LOCK_INTERRUPTED_LABEL : RECORD_LOCK_LEVEL_LABELS[level]}
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
  const interrupted = isInterruptedLockDisplay(lock);
  return (
    <span
      role="img"
      aria-label={interrupted ? RECORD_LOCK_INTERRUPTED_LABEL : RECORD_LOCK_LEVEL_LABELS.sent}
      title={interrupted ? RECORD_LOCK_INTERRUPTED_TITLE : RECORD_LOCK_SENT_TITLE}
      data-record-lock="sent"
      className={cn("inline-flex shrink-0", interrupted ? "text-[var(--st-bad)]" : "text-[var(--st-run)]", className)}
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
  return lock?.level === "sent" ? <RecordLockChip level="sent" interrupted={isInterruptedLockDisplay(lock)} className={className} /> : null;
}
