import type { ReactNode } from "react";
import { SubmitBlockContext, type SubmitBlock } from "@/components/ui/submit-block-context";
import { RECORD_LOCK_RETRY_LABEL, recordLockSaveBlock, type RecordLockStatus, type RecordLockView } from "@/lib/record-lock-view";
import { RecordLockChip } from "./record-lock-chip";
import { RecordLockNotice } from "./record-lock-notice";
import { RecordUsedBy } from "./record-used-by";

export interface RecordLockSheetOptions {
  lock: RecordLockView | undefined;
  status: RecordLockStatus;
  /** From `useRecordLock`: re-reads a failed lock in place. */
  retry?: () => void;
  retrying?: boolean;
  /** Storage bins name their stock history, not a record. */
  subject?: "record" | "storageBin";
  /** The form disables nothing while In use, so only Sent gets a line. */
  inUseLocksNothing?: boolean;
}

/** The lock's verdict on an open edit form, with the in-place retry. */
export function recordLockSubmitBlock({ lock, status, retry, retrying }: RecordLockSheetOptions): SubmitBlock | null {
  const block = recordLockSaveBlock(lock, status);
  return block && { ...block, ...(status === "error" && retry ? { retry: { label: RECORD_LOCK_RETRY_LABEL, run: retry, running: retrying } } : {}) };
}

/**
 * The record lock on an `EntitySideSheet`, in one place: the chip beside the
 * title, the lock line in view and edit mode, "Used by" after the read view,
 * and the Save block (pending and failed reads explain themselves beside
 * Save; Sent makes the form read-only). Spread it onto the sheet; keep
 * `canEdit` explicit where it combines with other rules.
 */
export function recordLockSheetProps(options: RecordLockSheetOptions) {
  const { lock, status, retry, retrying, subject, inUseLocksNothing } = options;
  return {
    titleBadge: lock ? <RecordLockChip level={lock.level} /> : undefined,
    viewModeNotice: (
      <RecordLockNotice lock={lock} status={status} onRetry={retry} retrying={retrying} subject={subject} inUseLocksNothing={inUseLocksNothing} />
    ),
    // In edit mode the pending and failed states sit beside Save instead.
    editNotice: <RecordLockNotice lock={lock} subject={subject} inUseLocksNothing={inUseLocksNothing} />,
    viewModeChildren: <RecordUsedBy lock={lock} />,
    submitBlock: recordLockSubmitBlock(options),
  };
}

/**
 * The same lock for an edit form outside a sheet (a picker's edit dialog):
 * the lock line above the form, Save off with its reason until the lock
 * answers, and every field read-only once it is Sent.
 */
export function RecordLockFormFrame({ children, ...options }: RecordLockSheetOptions & { children: ReactNode }) {
  const block = recordLockSubmitBlock(options);
  return (
    <SubmitBlockContext.Provider value={block}>
      <div className="flex flex-col gap-20">
        <RecordLockNotice lock={options.lock} subject={options.subject} inUseLocksNothing={options.inUseLocksNothing} />
        <fieldset disabled={!!block?.readOnly} className="contents">{children}</fieldset>
      </div>
    </SubmitBlockContext.Provider>
  );
}
