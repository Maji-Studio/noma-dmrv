import type { RecordLockViews } from "@/lib/record-lock-view";
import { RecordLockSentMark } from "./record-lock-chip";

/**
 * The Sent lock icon right before a list's record link (`meta.recordLinkBefore`).
 * It sits outside the link and shows only when the record is Sent.
 */
export function recordLockTitleMark<T extends { id: string }>(locks: RecordLockViews) {
  return function titleMark(row: T) {
    // No placeholder for unsent rows: almost none are Sent, so a reserved slot is a blank gutter on every list.
    return locks[row.id]?.level === "sent" ? <RecordLockSentMark lock={locks[row.id]} /> : null;
  };
}
