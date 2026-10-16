import { LinkSimpleIcon, LockSimpleIcon, LockSimpleOpenIcon } from "@phosphor-icons/react/dist/ssr";
import type { RecordLockStatus, RecordLockView } from "@/lib/record-lock-view";
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

/** A list cell: the chip once the batched read answered, a quiet word before. */
export function RecordLockCell({ lock, status = "ready" }: { lock: RecordLockView | undefined; status?: RecordLockStatus }) {
  if (lock) return <RecordLockChip level={lock.level} />;
  if (status === "pending") return <span className="body-caption text-[var(--color-text-tertiary)]">Checking…</span>;
  if (status === "error") return <span className="body-caption text-[var(--color-text-tertiary)]">{"Couldn't check"}</span>;
  return null;
}
