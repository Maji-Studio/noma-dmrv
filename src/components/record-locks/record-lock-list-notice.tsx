"use client";

import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { RECORD_LOCK_LIST_ERROR_MESSAGE, RECORD_LOCK_RETRY_LABEL } from "@/lib/record-lock-view";

/**
 * Above a list table: says so when the page's batched lock read failed, since
 * the rows then hide Edit and Delete. While the read is pending it shows
 * nothing; the actions simply appear.
 */
export function RecordLockListNotice({ read }: {
  read: { failed: boolean; retry: () => void; retrying: boolean };
}) {
  if (!read.failed) return null;
  return (
    <Notice
      tone="error"
      data-record-lock-notice="list-error"
      action={<Button variant="default" size="small" busy={read.retrying} onClick={read.retry}>{RECORD_LOCK_RETRY_LABEL}</Button>}
    >
      {RECORD_LOCK_LIST_ERROR_MESSAGE}
    </Notice>
  );
}
