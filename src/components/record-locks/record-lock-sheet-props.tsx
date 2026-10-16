import type { ReactNode } from "react";
import { SubmitBlockContext } from "@/components/ui/submit-block-context";
import { recordLockSaveBlockedReason, type RecordLockStatus, type RecordLockView } from "@/lib/record-lock-view";
import { RecordLockChip } from "./record-lock-chip";
import { RecordLockNotice } from "./record-lock-notice";
import { RecordUsedBy } from "./record-used-by";

export interface RecordLockSheetOptions {
  lock: RecordLockView | undefined;
  status: RecordLockStatus;
  /** Storage bins name their stock history, not a record. */
  subject?: "record" | "storageBin";
  /** The form disables nothing while In use, so only Sent gets a line. */
  inUseLocksNothing?: boolean;
}

/**
 * The record lock on an `EntitySideSheet`, in one place: the chip beside the
 * title, the lock line in view and edit mode, "Used by" after the read view,
 * and the reason Save is off. Spread it onto the sheet; keep `canEdit`
 * explicit where it combines with other rules.
 */
export function recordLockSheetProps({ lock, status, subject, inUseLocksNothing }: RecordLockSheetOptions) {
  const notice = <RecordLockNotice lock={lock} status={status} subject={subject} inUseLocksNothing={inUseLocksNothing} />;
  return {
    titleBadge: lock ? <RecordLockChip level={lock.level} /> : undefined,
    viewModeNotice: notice,
    editNotice: notice,
    viewModeChildren: <RecordUsedBy lock={lock} />,
    submitBlockedReason: recordLockSaveBlockedReason(lock, status),
  };
}

/**
 * The same lock for an edit form outside a sheet (a picker's edit dialog):
 * the lock line above the form, and Save off with its reason until the
 * lock answers or while it is Sent.
 */
export function RecordLockFormFrame({ children, ...options }: RecordLockSheetOptions & { children: ReactNode }) {
  return (
    <SubmitBlockContext.Provider value={recordLockSaveBlockedReason(options.lock, options.status)}>
      <div className="flex flex-col gap-20">
        <RecordLockNotice lock={options.lock} status={options.status} subject={options.subject} inUseLocksNothing={options.inUseLocksNothing} />
        {children}
      </div>
    </SubmitBlockContext.Provider>
  );
}
